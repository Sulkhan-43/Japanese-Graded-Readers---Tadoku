import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foldersRoot = path.join(root, 'Folders');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const libraryPath = path.join(foldersRoot, '.library-current.json');
const uploadConcurrency = Math.max(1, Math.min(5, Number(process.env.R2_UPLOAD_CONCURRENCY || 3)));

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
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.metadata.json')) files.push(fullPath);
  }
  return files;
}

async function wranglerCommand(args) {
  await execFileAsync(process.execPath, [wrangler, ...args], {
    cwd: root,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

const metadataPaths = (await walk(foldersRoot)).sort();
if (!metadataPaths.length) throw new Error('No local reader metadata files were found beneath Folders/.');

const books = [];
for (const metadataPath of metadataPaths) {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug || '') || !metadata.name || !metadata.level) {
    throw new Error(`Invalid reader metadata in ${metadataPath}`);
  }
  const basePath = metadataPath.replace(/\.metadata\.json$/, '');
  const outputRoot = path.dirname(path.dirname(metadataPath));
  const filename = path.basename(basePath);
  books.push({
    metadata,
    metadataPath,
    htmlPath: path.join(outputRoot, 'HTML', `${filename}.html`),
    pdfPath: path.join(outputRoot, 'PDF', `${filename}.pdf`),
    ocrPath: path.join(outputRoot, 'OCR', `${filename}-SuryaOCR.txt`),
    coverPath: path.join(outputRoot, 'COVER', `${filename}.jpg`),
    studyDataPath: `${basePath}.study-data.json`,
    pdfKey: metadata.pdfR2Key || `books/${metadata.slug}/source.pdf`,
  });
}

await wranglerCommand(['r2', 'object', 'get', 'todaku/library.json', '--remote', '--file', libraryPath]);
const library = JSON.parse(await readFile(libraryPath, 'utf8'));
if (!Array.isArray(library.books)) throw new Error('Remote library.json does not contain a books array.');

const existing = new Map(library.books.map((book) => [book.slug || book.id, book]));
for (const { metadata } of books) {
  existing.set(metadata.slug, {
    ...(existing.get(metadata.slug) || {}),
    id: metadata.slug,
    name: metadata.name,
    japaneseTitle: metadata.japaneseTitle || '',
    slug: metadata.slug,
    level: metadata.level,
    description: '',
    originalUrl: metadata.originalUrl || '',
    studyGuidePath: `/study/${metadata.slug}`,
    pdfPath: `/pdf/${metadata.slug}`,
    coverPath: metadata.coverR2Key ? `/assets/books/${metadata.slug}/cover?v=${encodeURIComponent(metadata.updatedAt || '')}` : null,
    status: 'completed',
  });
}
library.version = library.version || 1;
library.updatedAt = new Date().toISOString();
library.books = [...existing.values()];

let next = 0;
let completed = 0;
const failures = [];
async function worker() {
  while (true) {
    const index = next++;
    if (index >= books.length) return;
    const { metadata, metadataPath, htmlPath, pdfPath, ocrPath, coverPath, studyDataPath, pdfKey } = books[index];
    const publicMetadata = { ...metadata };
    delete publicMetadata.studyData;
    const publicMetadataPath = `${metadataPath}.public-tmp`;
    try {
      await writeFile(publicMetadataPath, `${JSON.stringify(publicMetadata, null, 2)}\n`, 'utf8');
      await wranglerCommand(['r2', 'object', 'put', `todaku/${pdfKey}`, '--remote', '--file', pdfPath, '--content-type', 'application/pdf']);
      await wranglerCommand(['r2', 'object', 'put', `todaku/books/${metadata.slug}/source-ocr.txt`, '--remote', '--file', ocrPath, '--content-type', 'text/plain; charset=utf-8']);
      await wranglerCommand(['r2', 'object', 'put', `todaku/${metadata.coverR2Key || `books/${metadata.slug}/cover.jpg`}`, '--remote', '--file', coverPath, '--content-type', 'image/jpeg']);
      await wranglerCommand(['r2', 'object', 'put', `todaku/books/${metadata.slug}/study-data.json`, '--remote', '--file', studyDataPath, '--content-type', 'application/json; charset=utf-8']);
      await wranglerCommand(['r2', 'object', 'put', `todaku/books/${metadata.slug}/metadata.json`, '--remote', '--file', publicMetadataPath, '--content-type', 'application/json; charset=utf-8']);
      await wranglerCommand(['r2', 'object', 'put', `todaku/books/${metadata.slug}/study-guide.html`, '--remote', '--file', htmlPath, '--content-type', 'text/html; charset=utf-8']);
      completed += 1;
      if (completed % 10 === 0 || completed === books.length) console.log(`Published assets for ${completed}/${books.length} readers.`);
    } catch {
      failures.push(metadata.slug);
      completed += 1;
      console.error(`Failed to upload one or more reader assets for ${metadata.slug}.`);
    } finally {
      await rm(publicMetadataPath, { force: true });
    }
  }
}

try {
  await Promise.all(Array.from({ length: Math.min(uploadConcurrency, books.length) }, () => worker()));
  if (failures.length) throw new Error(`R2 PDF upload failed for ${failures.length} reader(s); library.json was not updated.`);

  await writeFile(libraryPath, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
  await wranglerCommand(['r2', 'object', 'put', 'todaku/library.json', '--remote', '--file', libraryPath, '--content-type', 'application/json; charset=utf-8']);
  console.log(`Published ${books.length} reader(s) (PDF, OCR, cover, study data, public metadata, and guide) and updated library.json with ${library.books.length} reader(s).`);
} finally {
  await rm(libraryPath, { force: true });
}
