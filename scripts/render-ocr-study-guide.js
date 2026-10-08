import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const separator = arg.indexOf('=');
  return separator < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, separator), arg.slice(separator + 1)];
}));

const analysisPath = path.resolve(args.analysis || '');
const sourcePdf = path.resolve(args.pdf || '');
const sourceOcr = path.resolve(args.ocr || '');
const levelNumber = String(args.level || '');
if (!analysisPath || !sourcePdf || !sourceOcr || !/^\d+$/.test(levelNumber)) {
  throw new Error('Usage: node scripts/render-ocr-study-guide.js --analysis=<json> --pdf=<source.pdf> --ocr=<source.txt> --level=<number> [--title=<short-title>] [--slug=<slug>] [--cover-page=<one-based-page>]');
}

const data = JSON.parse(await readFile(analysisPath, 'utf8'));
if (args.title) data.title = String(args.title);
const level = `Level ${levelNumber}`;
const slugPart = (value) => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48)
  .replace(/-+$/g, '');
const titlePart = slugPart(data.title) || 'reader';
const slug = args.slug || `level${levelNumber}-${titlePart}`;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('The reader slug is invalid.');
const fileTitle = String(args['filename-title'] || titlePart).split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
const baseName = `Level${levelNumber}-${fileTitle}`;
const outputRoot = path.join(root, 'Folders', 'Processed', `Level${levelNumber}`);
const outputPaths = {
  OCR: path.join(outputRoot, 'OCR', `${baseName}-SuryaOCR.txt`),
  JSON: path.join(outputRoot, 'JSON', `${baseName}.metadata.json`),
  HTML: path.join(outputRoot, 'HTML', `${baseName}.html`),
  COVER: path.join(outputRoot, 'COVER', `${baseName}.jpg`),
  PDF: path.join(outputRoot, 'PDF', `${baseName}.pdf`),
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderSegments(segments = [], context = 'Japanese text') {
  if (!Array.isArray(segments)) throw new Error(`${context}: ruby segments are missing.`);
  return segments.map((segment) => {
    if (typeof segment.base === 'string' && typeof segment.reading === 'string' && segment.reading) {
      return `<ruby>${escapeHtml(segment.base)}<rt>${escapeHtml(segment.reading)}</rt></ruby>`;
    }
    if (typeof segment.text === 'string') {
      if (/[\u3400-\u4dbf\u4e00-\u9fff々〆ヶ]/u.test(segment.text)) {
        throw new Error(`${context}: kanji is present without furigana.`);
      }
      return escapeHtml(segment.text);
    }
    throw new Error(`${context}: malformed ruby segment.`);
  }).join('');
}

function validateStudyData(value) {
  if (!value || typeof value.title !== 'string' || !Array.isArray(value.passages) || !value.passages.length
    || !Array.isArray(value.vocabulary) || !Array.isArray(value.grammar)) {
    throw new Error('The model result must include a title, passages, vocabulary, and grammar.');
  }
  renderSegments(value.japaneseTitleSegments, 'Japanese title');
  const vocabularyKeys = new Set();
  const grammarKeys = new Set();
  for (const [index, item] of value.vocabulary.entries()) {
    renderSegments(item.japaneseSegments, `Vocabulary item ${index + 1}`);
    if (!item.japanese || !item.reading || !item.romaji || !item.meaning
      || !Number.isInteger(item.firstPassage) || !Number.isInteger(item.occurrenceCount)) {
      throw new Error(`Vocabulary item ${index + 1} is incomplete.`);
    }
    item.key = `vocabulary:${item.japanese}|${item.reading}`;
    vocabularyKeys.add(item.key);
  }
  for (const [index, item] of value.grammar.entries()) {
    renderSegments(item.patternSegments, `Grammar item ${index + 1}`);
    if (!item.pattern || !item.explanation
      || !Number.isInteger(item.firstPassage) || !Number.isInteger(item.occurrenceCount)) {
      throw new Error(`Grammar item ${index + 1} is incomplete.`);
    }
    item.key = `grammar:${item.pattern.normalize('NFKC').replace(/\s+/g, ' ').trim()}`;
    grammarKeys.add(item.key);
  }
  for (const [index, passage] of value.passages.entries()) {
    if (!Array.isArray(passage.sentences) || passage.sentences.length === 0) throw new Error(`Passage ${index + 1} has no sentences.`);
    for (const [sentenceIndex, sentence] of passage.sentences.entries()) {
      renderSegments(sentence.japaneseSegments, `Passage ${index + 1}, sentence ${sentenceIndex + 1}`);
      if (!sentence.romaji || !sentence.translation) throw new Error(`Passage ${index + 1}, sentence ${sentenceIndex + 1} is incomplete.`);
    }
    passage.vocabularyKeys = (passage.vocabularyKeys || []).map((key) => {
      if (vocabularyKeys.has(key)) return key;
      const normalized = value.vocabulary.find((item) => item.key === key || `vocabulary:${item.japanese}|${item.reading}` === key)?.key;
      if (!normalized) throw new Error(`Passage ${index + 1} refers to an unknown vocabulary item: ${key}`);
      return normalized;
    });
    passage.grammarKeys = (passage.grammarKeys || []).map((key) => {
      if (grammarKeys.has(key)) return key;
      const normalized = value.grammar.find((item) => item.key === key || `grammar:${item.pattern.normalize('NFKC').replace(/\s+/g, ' ').trim()}` === key)?.key;
      if (!normalized) throw new Error(`Passage ${index + 1} refers to an unknown grammar item: ${key}`);
      return normalized;
    });
  }
  return value;
}

function renderNotes(records, kind) {
  if (!records.length) return '';
  const label = kind === 'vocabulary' ? 'Vocabulary' : 'Grammar Notes';
  const rows = records.map((item) => {
    const japanese = kind === 'vocabulary'
      ? renderSegments(item.japaneseSegments, 'Vocabulary note')
      : renderSegments(item.patternSegments, 'Grammar note');
    const reading = kind === 'vocabulary' ? ` <span class="note-romaji">(${escapeHtml(item.romaji)})</span>` : '';
    const meaning = kind === 'vocabulary' ? item.meaning : item.explanation;
    return `<li><strong>${japanese}${reading}</strong><span class="note-meaning">${escapeHtml(meaning)}</span></li>`;
  }).join('');
  return `<section class="notes ${kind}" aria-label="${label}"><h3>${label}</h3><ul>${rows}</ul></section>`;
}

function renderPassages(value) {
  const vocabulary = new Map(value.vocabulary.map((item) => [item.key, item]));
  const grammar = new Map(value.grammar.map((item) => [item.key, item]));
  return value.passages.map((passage, index) => {
    const label = passage.label || `Passage ${index + 1}`;
    const sentences = passage.sentences.map((sentence, sentenceIndex) => `<div class="sentence">
      <p class="japanese" lang="ja">${renderSegments(sentence.japaneseSegments, `Passage ${index + 1}, sentence ${sentenceIndex + 1}`)}</p>
      <p class="romaji"><span class="language-label">Romaji</span>${escapeHtml(sentence.romaji)}</p>
      <p class="translation"><span class="language-label">English</span>${escapeHtml(sentence.translation)}</p>
    </div>`).join('');
    const vocabNotes = (passage.vocabularyKeys || []).map((key) => vocabulary.get(key)).filter(Boolean);
    const grammarNotes = (passage.grammarKeys || []).map((key) => grammar.get(key)).filter(Boolean);
    const notes = [renderNotes(vocabNotes, 'vocabulary'), renderNotes(grammarNotes, 'grammar')].filter(Boolean).join('');
    return `<article class="passage-card"><header><h2>${escapeHtml(label)}</h2><span>Passage ${index + 1} of ${value.passages.length}</span></header>
      <div class="passage-content">${sentences}</div>${notes ? `<div class="study-notes">${notes}</div>` : ''}</article>`;
  }).join('\n');
}

function renderIndexRows(value, globalTotals = {}) {
  const vocabRows = [...value.vocabulary]
    .sort((left, right) => (globalTotals.vocabulary?.[right.key] ?? right.occurrenceCount)
      - (globalTotals.vocabulary?.[left.key] ?? left.occurrenceCount)
      || left.japanese.localeCompare(right.japanese, 'ja'))
    .map((item) => `<tr><td class="index-japanese">${renderSegments(item.japaneseSegments, 'Vocabulary index')}</td>
      <td>${escapeHtml(item.romaji)}</td><td>${escapeHtml(item.meaning)}</td><td>${item.firstPassage}</td>
      <td>${globalTotals.vocabulary?.[item.key] ?? item.occurrenceCount}</td></tr>`).join('\n');
  const grammarRows = [...value.grammar]
    .sort((left, right) => (globalTotals.grammar?.[right.key] ?? right.occurrenceCount)
      - (globalTotals.grammar?.[left.key] ?? left.occurrenceCount)
      || left.pattern.localeCompare(right.pattern, 'ja'))
    .map((item) => `<tr><td class="index-japanese">${renderSegments(item.patternSegments, 'Grammar index')}</td>
      <td>${escapeHtml(item.explanation)}</td><td>${item.firstPassage}</td>
      <td>${globalTotals.grammar?.[item.key] ?? item.occurrenceCount}</td></tr>`).join('\n');
  return `<section class="index-grid">
    <section class="index-card" aria-labelledby="vocabulary-index-title"><header><h2 id="vocabulary-index-title">Master vocabulary index</h2><p>Unique terms explained in this reader. Total occurrences combine the imported reader collection.</p></header>
      <div class="table-wrap"><table><thead><tr><th>Japanese</th><th>Romaji</th><th>Meaning</th><th>First passage</th><th>Total occurrences</th></tr></thead><tbody>${vocabRows}</tbody></table></div>
    </section>
    <section class="index-card" aria-labelledby="grammar-index-title"><header><h2 id="grammar-index-title">Master grammar index</h2><p>Grammar points explained in this reader, ranked by their total occurrences across the imported collection.</p></header>
      <div class="table-wrap"><table><thead><tr><th>Pattern</th><th>Meaning / use</th><th>First passage</th><th>Total occurrences</th></tr></thead><tbody>${grammarRows}</tbody></table></div>
    </section>
  </section>`;
}

const style = `:root{color-scheme:light;--ink:#243c32;--muted:#66796e;--line:#e7deda;--paper:#fbf7f4;--card:#fffdfb;--green:#315b46;--green-soft:#edf5ef;--rose:#b65772;--rose-soft:#fff0f3;--gold:#9b673a;--gold-soft:#fff6e8;--blue:#4f7290;--blue-soft:#eef5fa}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#fffaf7,var(--paper));color:var(--ink);font:16px/1.7 Georgia,'Yu Mincho',serif}.report{width:min(1080px,calc(100% - 34px));margin:34px auto 72px}.report-header{padding:34px clamp(22px,5vw,54px);border:1px solid var(--line);border-top:5px solid var(--green);border-radius:12px;background:var(--card);box-shadow:0 10px 30px #5539290a}.eyebrow,.section-label,.language-label{font:700 10px/1.5 Arial,sans-serif;letter-spacing:.13em;text-transform:uppercase}.eyebrow{color:#b94f3b}.report-header h1{margin:11px 0 3px;font-size:clamp(34px,6vw,52px);font-weight:500;line-height:1.12}.japanese-title{margin:8px 0 14px;color:var(--green);font-size:27px}.report-meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted);font:12px Arial,sans-serif}.report-note{margin:20px 0 0;padding:12px 15px;border-left:3px solid #d18a53;border-radius:0 7px 7px 0;background:var(--gold-soft);color:#735b42;font:13px/1.65 Arial,sans-serif}.passage-card{overflow:visible;margin:18px 0;border:1px solid var(--line);border-radius:10px;background:var(--card);box-shadow:0 6px 22px #48372a0a}.passage-card>header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid #f0e7e3}.passage-card>header h2{margin:0;font-size:17px;font-weight:600}.passage-card>header span{color:#8d8179;font:10px Arial,sans-serif}.passage-content{padding:24px clamp(18px,4vw,42px) 13px}.sentence{margin:0 0 17px}.sentence:last-child{margin-bottom:0}.japanese{margin:0;color:#173b57;font-size:clamp(25px,4vw,32px);line-height:2.15;letter-spacing:.025em}.japanese ruby,.japanese ruby rt{ruby-position:over}.japanese rt,.index-japanese rt,.notes rt{color:var(--rose);font:11px/1.15 Arial,sans-serif;letter-spacing:0}.romaji,.translation{margin:5px 0 0;padding:8px 12px;border-radius:7px;font:14px/1.65 Arial,sans-serif}.romaji{background:var(--green-soft);color:#315d47}.translation{background:var(--rose-soft);color:#824554}.language-label{display:inline-block;margin-right:10px;color:#737f78;font-size:9px}.study-notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:6px 16px 16px}.notes{padding:14px 16px;border-radius:8px;background:var(--gold-soft)}.notes.grammar{background:var(--green-soft)}.notes h3{margin:0;color:#855b2f;font:700 10px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase}.notes.grammar h3{color:#3b674d}.notes ul{margin:8px 0 0;padding-left:18px;color:#47574e;font:12px/1.8 Arial,sans-serif}.notes li{padding:2px 0}.notes strong{color:#263d32;font-size:13px}.note-romaji{color:var(--blue);font-weight:500}.note-meaning{margin-left:5px}.index-grid{margin-top:37px}.index-card{margin:19px 0;padding:18px;border:1px solid var(--line);border-radius:9px;background:var(--card)}.index-card>header h2{margin:0;font-size:21px;font-weight:500}.index-card>header p{margin:4px 0 13px;color:#7b746e;font:11px/1.6 Arial,sans-serif}.table-wrap{overflow:auto;border:1px solid #eadfdb;border-radius:5px}table{width:100%;border-collapse:collapse;font:11px/1.55 Arial,sans-serif}th,td{padding:8px 10px;border-bottom:1px solid #eee4e0;text-align:left;vertical-align:top}th{background:#fff1f3;color:#87535d;font:700 9px Arial,sans-serif;letter-spacing:.035em}.index-japanese{white-space:nowrap;color:#173b57;font:18px/1.8 'Yu Mincho',serif}.report-footer{margin-top:30px;padding-top:12px;border-top:1px solid var(--line);color:#888078;font:10px Arial,sans-serif}@media(max-width:700px){.report{width:calc(100% - 18px);margin:12px auto 42px}.report-header{padding:24px 18px}.passage-content{padding:17px 15px 12px}.study-notes{grid-template-columns:1fr;padding:4px 12px 12px}.notes{padding:12px}.japanese{font-size:24px}.index-card{padding:12px}.index-card>header h2{font-size:18px}th,td{padding:7px}}`;

validateStudyData(data);
const titleRuby = renderSegments(data.japaneseTitleSegments, 'Japanese title');
const indexes = renderIndexRows(data);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#fbf7f4"><title>${escapeHtml(data.title)} · ${escapeHtml(level)} Japanese Study Guide</title><style>${style}</style></head><body><main class="report">
  <header class="report-header"><span class="eyebrow">Japanese graded reader · ${escapeHtml(level)}</span><h1>${escapeHtml(data.title)}</h1><div class="japanese-title" lang="ja">${titleRuby}</div>
    <div class="report-meta"><span>${data.passages.length} study passages/pages processed</span><span>Japanese · Romaji · English</span></div>
    <p class="report-note">Repeated vocabulary and grammar explanations are intentionally omitted after their first useful explanation.</p>
  </header>
  ${renderPassages(data)}
  <div class="master-index-region"><!-- MASTER-INDEX-START -->${indexes}<!-- MASTER-INDEX-END --></div>
  <footer class="report-footer">Self-contained Japanese study guide · Furigana is shown above kanji throughout.</footer>
</main></body></html>`;

const studyData = {
  version: 1,
  countScope: 'Original Japanese story passages, title, and story-specific synopsis; excludes generated notes, romaji, translations, and publisher material.',
  vocabulary: data.vocabulary,
  grammar: data.grammar,
};
const metadata = {
  id: slug,
  name: data.title,
  japaneseTitle: data.japaneseTitle,
  slug,
  level,
  description: '',
  originalUrl: '',
  pdfR2Key: `books/${slug}/source.pdf`,
  ocrR2Key: `books/${slug}/source-ocr.txt`,
  coverR2Key: `books/${slug}/cover.jpg`,
  htmlR2Key: `books/${slug}/study-guide.html`,
  generationStatus: 'completed',
  generationProgress: 100,
  generationError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  studyData,
};

for (const directory of ['OCR', 'JSON', 'HTML', 'COVER', 'PDF']) await mkdir(path.join(outputRoot, directory), { recursive: true });
await copyFile(sourcePdf, outputPaths.PDF);
await copyFile(sourceOcr, outputPaths.OCR);
await writeFile(outputPaths.JSON, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
await writeFile(path.join(outputRoot, 'JSON', `${baseName}.study-data.json`), `${JSON.stringify(studyData, null, 2)}\n`, 'utf8');
await writeFile(outputPaths.HTML, html, 'utf8');

const python = process.env.PYTHON_EXECUTABLE || 'C:\\Users\\admin\\AppData\\Roaming\\uv\\python\\cpython-3.12.14-windows-x86_64-none\\python.exe';
const pymupdfPath = process.env.PYMUPDF_PATH || 'C:\\Users\\admin\\AppData\\Local\\Temp\\tadoku-codex-pdf-tools';
const page = Math.max(1, Number(args['cover-page'] || 2));
const renderCover = [
  'import os, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import pymupdf',
  'doc = pymupdf.open(sys.argv[2])',
  'index = min(max(0, int(sys.argv[4]) - 1), len(doc) - 1)',
  'page = doc[index]',
  'page.get_pixmap(matrix=pymupdf.Matrix(2.0, 2.0), alpha=False).save(sys.argv[3])',
].join('\n');
const rendered = spawnSync(python, ['-c', renderCover, pymupdfPath, sourcePdf, outputPaths.COVER, String(page)], { cwd: root, windowsHide: true, encoding: 'utf8' });
if (rendered.status !== 0) throw new Error(`Could not render a cover image (${rendered.error?.message || rendered.stderr?.trim() || `exit ${rendered.status}`}).`);

console.log(JSON.stringify({
  slug,
  title: data.title,
  localBaseName: baseName,
  passages: data.passages.length,
  vocabulary: data.vocabulary.length,
  grammar: data.grammar.length,
  coverPage: page,
  outputs: outputPaths,
}));
