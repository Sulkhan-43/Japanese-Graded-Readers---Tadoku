import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foldersRoot = path.join(root, 'Folders');
const startMarker = '<!-- MASTER-INDEX-START -->';
const endMarker = '<!-- MASTER-INDEX-END -->';
const upload = process.argv.includes('--upload');

function grammarSegments(record) {
  return record.patternSegments || record.segments || [];
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderJapanese(segments = []) {
  const japanese = segments.map((segment) => {
    if (segment.base !== undefined) {
      return `<ruby>${escapeHtml(segment.base)}<rt>${escapeHtml(segment.reading)}</rt></ruby>`;
    }
    return escapeHtml(segment.text || '');
  }).join('');
  return `<span class="note-loupe-trigger" tabindex="0">${japanese}<span class="jp-loupe note-loupe" aria-hidden="true"><div class="loupe-kicker">Reading loupe · magnified</div><div class="jp jp-loupe-text note-loupe-text">${japanese}</div></span></span>`;
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.metadata.json')) files.push(fullPath);
  }
  return files;
}

function addRecord(index, record, book, kind) {
  if (!record.key || !Number.isInteger(record.occurrenceCount) || record.occurrenceCount < 0) {
    throw new Error(`Invalid ${kind} record in ${book.slug}: ${record.key || '(missing key)'}`);
  }
  const current = index.get(record.key);
  if (current?.books.some((item) => item.slug === book.slug)) {
    throw new Error(`Duplicate ${kind} key ${record.key} in ${book.slug}`);
  }

  const initial = kind === 'vocabulary'
    ? {
        key: record.key,
        japanese: record.japanese,
        japaneseSegments: record.japaneseSegments || [],
        reading: record.reading || '',
        romaji: record.romaji || '',
        meaning: record.meaning || '',
      }
    : {
        key: record.key,
        pattern: record.pattern,
        patternSegments: grammarSegments(record),
        explanation: record.explanation || '',
      };

  const entry = current || { ...initial, totalOccurrences: 0, books: [] };
  entry.totalOccurrences += record.occurrenceCount;
  entry.books.push({
    slug: book.slug,
    name: book.name,
    level: book.level,
    occurrences: record.occurrenceCount,
    firstPassage: record.firstPassage,
  });
  index.set(record.key, entry);
}

function occurrenceCell(entry) {
  return `<div class="reader-counts">${entry.books.map((book) => (
    `<span class="reader-count" title="${book.occurrences} occurrences in ${escapeHtml(book.name)}">` +
    `${escapeHtml(book.level)} · ${escapeHtml(book.name)} <strong>×${book.occurrences}</strong></span>`
  )).join('')}</div>`;
}

function renderMasterIndexes(metadata, globalIndex) {
  const vocabRows = [...metadata.studyData.vocabulary]
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.japanese.localeCompare(b.japanese, 'ja'))
    .map((record) => {
    const global = globalIndex.vocabulary.find((item) => item.key === record.key);
    if (!global) throw new Error(`Global vocabulary index lacks ${record.key}`);
    return `<tr><td class="index-japanese">${renderJapanese(record.japaneseSegments)}</td>` +
      `<td>${escapeHtml(record.romaji)}</td><td>${escapeHtml(record.meaning)}</td>` +
      `<td>${escapeHtml(record.firstPassage)}</td><td>${occurrenceCell(global)}</td></tr>`;
  }).join('\n');

  const grammarRows = metadata.studyData.grammar.map((record) => {
    const global = globalIndex.grammar.find((item) => item.key === record.key);
    if (!global) throw new Error(`Global grammar index lacks ${record.key}`);
    return `<tr><td class="index-japanese">${renderJapanese(grammarSegments(record))}</td>` +
      `<td>${escapeHtml(record.explanation)}</td><td>${escapeHtml(record.firstPassage)}</td>` +
      `<td>${occurrenceCell(global)}</td></tr>`;
  }).join('\n');

  return `<section class="master-index" aria-label="Master vocabulary and grammar indexes">
      <section class="index-card" aria-labelledby="vocabulary-index-title">
        <div class="index-card-head"><h2 id="vocabulary-index-title">Master vocabulary index</h2><p>Unique vocabulary introduced in this reader. Occurrence counts include Japanese story text and the synopsis, not study notes.</p></div>
        <div class="index-table-wrap"><table class="master-table"><thead><tr><th scope="col">Japanese</th><th scope="col">Romaji</th><th scope="col">Meaning</th><th scope="col">First passage</th><th scope="col">Occurrences by reader</th></tr></thead><tbody>
${vocabRows}
        </tbody></table></div>
      </section>
      <section class="index-card" aria-labelledby="grammar-index-title">
        <div class="index-card-head"><h2 id="grammar-index-title">Master grammar index</h2><p>Grammar points are explained at their first useful occurrence. Counts show each construction use; repeated uses in one sentence count separately.</p></div>
        <div class="index-table-wrap"><table class="master-table grammar-table"><thead><tr><th scope="col">Pattern</th><th scope="col">Meaning / use</th><th scope="col">First passage</th><th scope="col">Occurrences by reader</th></tr></thead><tbody>
${grammarRows}
        </tbody></table></div>
      </section>
    </section>`;
}

function replaceMasterIndex(html, renderedIndex) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start >= 0 && end > start) {
    return html.slice(0, start) + startMarker + '\n' + renderedIndex + '\n' + endMarker + html.slice(end + endMarker.length);
  }

  // Add markers around the report's existing index the first time this script runs.
  const existing = html.indexOf('<section class="master-index"');
  const footer = html.indexOf('    <footer>', existing);
  if (existing < 0 || footer < 0) throw new Error('Guide needs a master-index section before its footer.');
  return html.slice(0, existing) + startMarker + '\n' + renderedIndex + '\n' + endMarker + '\n' + html.slice(footer);
}

async function loadBooks() {
  const metadataPaths = (await walk(foldersRoot)).sort();
  if (!metadataPaths.length) throw new Error('No *.metadata.json files found beneath Folders/.');

  const books = [];
  for (const metadataPath of metadataPaths) {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug || '')) {
      throw new Error(`Invalid or missing slug in ${metadataPath}`);
    }
    if (!metadata.studyData?.vocabulary || !metadata.studyData?.grammar) {
      throw new Error(`Missing studyData in ${metadataPath}`);
    }
    const htmlPath = metadataPath.replace(/\.metadata\.json$/, '.html');
    books.push({ metadataPath, htmlPath, metadata });
  }
  return books;
}

async function uploadObject(key, file, contentType) {
  const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  execFileSync(process.execPath, [wrangler, 'r2', 'object', 'put', `todaku/${key}`, '--remote', '--file', file, '--content-type', contentType], {
    cwd: root,
    stdio: 'inherit',
  });
}

const books = await loadBooks();
const vocabulary = new Map();
const grammar = new Map();
const bookList = {};

for (const { metadata } of books) {
  const book = { slug: metadata.slug, name: metadata.name, level: metadata.level };
  bookList[book.slug] = { name: book.name, level: book.level };
  for (const record of metadata.studyData.vocabulary) addRecord(vocabulary, record, book, 'vocabulary');
  for (const record of metadata.studyData.grammar) addRecord(grammar, record, book, 'grammar');
}

const globalIndex = {
  version: 1,
  updatedAt: new Date().toISOString(),
  countScope: 'Original Japanese story passages, related captions/maps, and story-specific synopses; excludes study notes, romaji, translations, and publisher material.',
  books: bookList,
  vocabulary: [...vocabulary.values()].sort((a, b) => a.japanese.localeCompare(b.japanese, 'ja')),
  grammar: [...grammar.values()].sort((a, b) => a.pattern.localeCompare(b.pattern, 'en')),
};

for (const { metadataPath, htmlPath, metadata } of books) {
  let guide = await readFile(htmlPath, 'utf8');
  guide = replaceMasterIndex(guide, renderMasterIndexes(metadata, globalIndex));
  await writeFile(htmlPath, guide, 'utf8');
}

console.log(`Refreshed local guide fallback indexes from ${books.length} reader(s): ${globalIndex.vocabulary.length} vocabulary items, ${globalIndex.grammar.length} grammar points.`);
if (upload) {
  for (const { metadataPath, htmlPath, metadata } of books) {
    const publicMetadata = { ...metadata };
    delete publicMetadata.studyData;
    const publicMetadataPath = `${metadataPath}.public-tmp`;
    try {
      await writeFile(publicMetadataPath, `${JSON.stringify(publicMetadata, null, 2)}\n`, 'utf8');
      await uploadObject(`books/${metadata.slug}/metadata.json`, publicMetadataPath, 'application/json; charset=utf-8');
    } finally {
      await rm(publicMetadataPath, { force: true });
    }
    await uploadObject(metadata.htmlR2Key || `books/${metadata.slug}/study-guide.html`, htmlPath, 'text/html; charset=utf-8');
  }
}
