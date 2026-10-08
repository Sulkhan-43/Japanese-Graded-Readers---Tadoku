import { createHash } from 'node:crypto';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foldersRoot = path.join(root, 'Folders');
const sourceRoot = path.join(foldersRoot, 'Books', '0');
const ocrRoot = path.join(foldersRoot, 'OCR');
const manifestPath = path.join(foldersRoot, '.processed-pdf-sources.json');
const failuresPath = path.join(foldersRoot, '.pdf-processing-failures.json');
const reviewPath = path.join(sourceRoot, 'PROCESSING-REVIEW.md');

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

function normalizedName(value) {
  return path.basename(value).normalize('NFKC').toLowerCase()
    .replace(/\.(pdf|txt)$/i, '')
    .replace(/^level\d+[-\s]*/i, '')
    .replace(/[-\s]+suryaocr$/i, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/gu, '');
}

async function listPdfs(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) files.push(entry.name);
  }
  return files.sort(new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare);
}

async function checkOcrMatches(pdfNames) {
  const ocrNames = (await readdir(ocrRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt') && entry.name.toLowerCase().startsWith('level0-'))
    .map((entry) => entry.name);
  const problems = [];
  for (const pdfName of pdfNames) {
    const stem = normalizedName(pdfName);
    if (stem.includes('sakura') || stem.includes('daizu')) continue;
    const matches = ocrNames.filter((ocrName) => normalizedName(ocrName) === stem);
    if (matches.length !== 1) problems.push({ pdfName, matches });
  }
  return problems;
}

async function hashFile(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function exists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

const pdfNames = await listPdfs(sourceRoot);
if (!pdfNames.length) throw new Error('No source PDFs were found in Folders/Books/0.');

const priorReview = await readFile(reviewPath, 'utf8').catch(() => '');
const ignoredSections = priorReview.split(/(?=^## )/m)
  .map((section) => section.trim())
  .filter((section) => section.startsWith('## IGNORED:'));
const ignoredNames = new Set(ignoredSections.map((section) => section.slice('## IGNORED:'.length).split(/\r?\n/, 1)[0].trim()));
const ignoredPdfs = pdfNames.filter((pdfName) => ignoredNames.has(pdfName));
const activePdfNames = pdfNames.filter((pdfName) => !ignoredNames.has(pdfName));

let priorFailures = [];
try { priorFailures = JSON.parse(await readFile(failuresPath, 'utf8')); } catch { /* no failure history yet */ }
const activeFailures = priorFailures.filter((failure) => !ignoredNames.has(path.basename(failure.path || '')));
if (activeFailures.length !== priorFailures.length) await writeFile(failuresPath, `${JSON.stringify(activeFailures, null, 2)}\n`, 'utf8');

const matchProblems = await checkOcrMatches(activePdfNames);
if (matchProblems.length || ignoredSections.length) {
  const queues = matchProblems.map(({ pdfName, matches }) => `## WAITING_FOR_USER: ${pdfName}\n\n- Level: 0\n- PDF: \`Folders/Books/0/${pdfName}\`\n- OCR candidates: ${matches.length ? matches.map((name) => `\`Folders/OCR/${name}\``).join(', ') : 'none found'}\n- Selected OCR path:\n`).join('\n');
  const ignored = ignoredSections.join('\n\n');
  await writeFile(reviewPath, `# Level 0 PDF/OCR matching review\n\nResolve waiting items when available. Ignored PDFs remain in Folders/Books/0 and are excluded from future batches.\n\n${ignored}${ignored && queues ? '\n\n' : ''}${queues}`, 'utf8');
} else {
  await rm(reviewPath, { force: true });
}

const heldForReview = new Set(matchProblems.map(({ pdfName }) => pdfName));
const clearSources = activePdfNames.filter((pdfName) => !heldForReview.has(pdfName));
if (!clearSources.length) throw new Error(`No unambiguous Level 0 PDFs are ready. Review ${path.relative(root, reviewPath)}.`);

console.log(`Level 0 batch: ${clearSources.length} clear PDFs; Sakura and Daizu use direct PDF page images; the remaining clear readers use matching Surya OCR files.`);

const processorExit = await runNode('process-local-pdfs.js', [
  '--codex',
  '--source-dir=Folders/Books/0',
  '--ocr-dir=Folders/OCR',
  '--pdf-only=sakura,daizu',
  `--source-files-json=${encodeURIComponent(JSON.stringify(clearSources))}`,
]);

let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { manifest = { processedHashes: {} }; }
const sourcePrefix = 'Folders/Books/0/';
const processedEntries = Object.values(manifest.processedHashes || {})
  .filter((entry) => entry?.slug && entry?.source?.startsWith(sourcePrefix) && entry?.canonicalPdf)
  .sort((left, right) => left.source.localeCompare(right.source, 'en', { numeric: true }));
const publishable = [];
for (const entry of processedEntries) {
  const copiedPdf = path.resolve(root, entry.canonicalPdf);
  if (!(await exists(copiedPdf))) continue;
  const base = path.basename(copiedPdf, '.pdf');
  const metadataPath = path.join(path.dirname(path.dirname(copiedPdf)), 'JSON', `${base}.metadata.json`);
  if (!(await exists(metadataPath))) continue;
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (metadata.slug === entry.slug) publishable.push({ entry, copiedPdf, metadataPath });
}

if (!publishable.length) {
  if (processorExit !== 0) {
    const failures = await readFile(failuresPath, 'utf8').catch(() => '[]');
    const rows = JSON.parse(failures).filter((failure) => !ignoredNames.has(path.basename(failure.path || '')))
      .map((failure) => `| ${failure.path.replaceAll('|', '\\|')} | ${failure.message.replaceAll('|', '\\|')} |`).join('\n');
    const ignored = ignoredSections.join('\n\n');
    await writeFile(reviewPath, `# Level 0 processing review\n\nNo guides were ready to publish. Failed PDFs remain in Folders/Books/0.\n\n${ignored}${ignored ? '\n\n' : ''}| PDF | Issue |\n| --- | --- |\n${rows}\n`, 'utf8');
  }
  throw new Error('The batch produced no complete local readers; source PDFs were left in place.');
}

const slugs = [...new Set(publishable.map(({ entry }) => entry.slug))];
const slugArgument = `--slugs=${slugs.join(',')}`;
console.log(`Importing and publishing ${slugs.length} completed reader(s).`);
const databaseExit = await runNode('sync-study-database.js', ['--upload', slugArgument]);
if (databaseExit !== 0) throw new Error('Database import failed; all original PDFs remain in Folders/Books/0.');
const publishExit = await runNode('publish-local-pdfs.js', [slugArgument]);
if (publishExit !== 0) throw new Error('R2 asset or library publishing failed; all original PDFs remain in Folders/Books/0.');

const publicResponse = await fetch('https://todaku.pages.dev/api/books', { cache: 'no-store' });
if (!publicResponse.ok) throw new Error(`Could not verify the published library (HTTP ${publicResponse.status}); source PDFs were left in place.`);
const publicLibrary = await publicResponse.json();
const publicSlugs = new Set((publicLibrary.books || []).map((book) => book.slug || book.id));
const missingSlugs = slugs.filter((slug) => !publicSlugs.has(slug));
if (missingSlugs.length) throw new Error(`Published library verification is missing ${missingSlugs.length} reader(s); source PDFs were left in place.`);

let deleted = 0;
for (const { entry, copiedPdf } of publishable) {
  const sourcePdf = path.resolve(root, entry.source);
  if (!(await exists(sourcePdf))) continue;
  if (await hashFile(sourcePdf) !== await hashFile(copiedPdf)) {
    throw new Error(`The processed PDF copy does not match its source: ${entry.source}. The source was kept.`);
  }
  await rm(sourcePdf);
  deleted += 1;
}

let failures = [];
try { failures = JSON.parse(await readFile(failuresPath, 'utf8')); } catch { /* no failure report yet */ }
failures = failures.filter((failure) => !ignoredNames.has(path.basename(failure.path || '')));
if (failures.length || matchProblems.length || ignoredSections.length) {
  const queues = matchProblems.map(({ pdfName, matches }) => `## WAITING_FOR_USER: ${pdfName}\n\n- Level: 0\n- PDF: \`Folders/Books/0/${pdfName}\`\n- OCR candidates: ${matches.length ? matches.map((name) => `\`Folders/OCR/${name}\``).join(', ') : 'none found'}\n- Selected OCR path:\n`).join('\n');
  const ignored = ignoredSections.join('\n\n');
  const failureRows = failures.map((failure) => `| ${failure.path.replaceAll('|', '\\|')} | ${failure.message.replaceAll('|', '\\|')} |`).join('\n');
  const failureSection = failures.length ? `## Processing failures\n\nThese source PDFs were retained for retry.\n\n| PDF | Issue |\n| --- | --- |\n${failureRows}\n` : '';
  await writeFile(reviewPath, `# Level 0 processing review\n\n${ignored}${ignored && (queues || failureSection) ? '\n\n' : ''}${queues}${failureSection}`, 'utf8');
} else {
  await rm(reviewPath, { force: true });
}

console.log(`Verified ${slugs.length} published reader(s), removed ${deleted} original PDF(s) after confirming their processed copies and public catalog entries.${failures.length ? ` ${failures.length} PDF(s) remain queued in ${path.relative(root, reviewPath)}.` : ''}${ignoredPdfs.length ? ` ${ignoredPdfs.length} PDF(s) remain marked Ignored.` : ''}`);
