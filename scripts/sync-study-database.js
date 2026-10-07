import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foldersRoot = path.join(root, 'Folders');
const migrationsRoot = path.join(root, 'db', 'migrations');
const upload = process.argv.includes('--upload');
const migrateOnly = process.argv.includes('--migrate-only');

function grammarSegments(record) {
  return record.patternSegments || record.segments || [];
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

async function loadBooks() {
  const paths = (await walk(foldersRoot)).sort();
  if (!paths.length) throw new Error('No local *.metadata.json sidecars were found beneath Folders/.');
  const books = [];
  for (const metadataPath of paths) {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug || '')) {
      throw new Error(`Invalid or missing slug in ${metadataPath}`);
    }
    if (!metadata.name || !metadata.level || !Array.isArray(metadata.studyData?.vocabulary) || !Array.isArray(metadata.studyData?.grammar)) {
      throw new Error(`Incomplete book metadata or studyData in ${metadataPath}`);
    }
    validateRecords(metadata.studyData.vocabulary, metadata.slug, 'vocabulary');
    validateRecords(metadata.studyData.grammar, metadata.slug, 'grammar');
    books.push({ metadataPath, metadata });
  }
  return books;
}

function validateRecords(records, slug, kind) {
  const keys = new Set();
  for (const record of records) {
    if (!record.key || !Number.isInteger(record.occurrenceCount) || record.occurrenceCount < 0) {
      throw new Error(`Invalid ${kind} record in ${slug}: ${record.key || '(missing key)'}`);
    }
    if (keys.has(record.key)) throw new Error(`Duplicate ${kind} key ${record.key} in ${slug}`);
    keys.add(record.key);
  }
}

async function applyMigrations(client) {
  const names = (await readdir(migrationsRoot)).filter((name) => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error('No SQL migrations were found.');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  for (const name of names) {
    const match = name.match(/^(\d+)-(.+)\.sql$/);
    if (!match) throw new Error(`Migration filename must start with a numeric version: ${name}`);
    const [, version] = match;
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(migrationsRoot, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function importBooks(client, books) {
  await client.query('BEGIN');
  try {
    for (const { metadata } of books) {
      const { studyData, ...publicMetadata } = metadata;
      await client.query(
        `INSERT INTO study_books (slug, name, level, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           level = EXCLUDED.level,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [metadata.slug, metadata.name, metadata.level, JSON.stringify(publicMetadata)],
      );

      // Replace each reader's joins so repeated imports set counts instead of adding to them.
      await client.query('DELETE FROM study_book_vocabulary WHERE book_slug = $1', [metadata.slug]);
      await client.query('DELETE FROM study_book_grammar WHERE book_slug = $1', [metadata.slug]);

      await client.query(
        `INSERT INTO study_vocabulary
           (vocabulary_key, japanese, reading, romaji, meaning, japanese_segments)
         SELECT item.key, item.japanese, COALESCE(item.reading, ''), COALESCE(item.romaji, ''),
                COALESCE(item.meaning, ''), COALESCE(item."japaneseSegments", '[]'::jsonb)
         FROM jsonb_to_recordset($1::jsonb) AS item(
           key text, japanese text, reading text, romaji text, meaning text, "japaneseSegments" jsonb
         )
         ON CONFLICT (vocabulary_key) DO NOTHING`,
        [JSON.stringify(studyData.vocabulary)],
      );
      await client.query(
        `INSERT INTO study_book_vocabulary (book_slug, vocabulary_key, occurrence_count, first_passage)
         SELECT $2, item.key, item."occurrenceCount", item."firstPassage"
         FROM jsonb_to_recordset($1::jsonb) AS item(
           key text, "occurrenceCount" integer, "firstPassage" jsonb
         )`,
        [JSON.stringify(studyData.vocabulary.map((record) => ({ ...record, firstPassage: record.firstPassage ?? null }))), metadata.slug],
      );

      const normalizedGrammar = studyData.grammar.map((record) => ({
        ...record,
        patternSegments: grammarSegments(record),
      }));
      await client.query(
        `INSERT INTO study_grammar (grammar_key, pattern, pattern_segments, explanation)
         SELECT item.key, item.pattern, COALESCE(item."patternSegments", '[]'::jsonb), COALESCE(item.explanation, '')
         FROM jsonb_to_recordset($1::jsonb) AS item(
           key text, pattern text, "patternSegments" jsonb, explanation text
         )
         ON CONFLICT (grammar_key) DO NOTHING`,
        [JSON.stringify(normalizedGrammar)],
      );
      await client.query(
        `INSERT INTO study_book_grammar (book_slug, grammar_key, occurrence_count, first_passage)
         SELECT $2, item.key, item."occurrenceCount", item."firstPassage"
         FROM jsonb_to_recordset($1::jsonb) AS item(
           key text, "occurrenceCount" integer, "firstPassage" jsonb
         )`,
        [JSON.stringify(normalizedGrammar.map((record) => ({ ...record, firstPassage: record.firstPassage ?? null }))), metadata.slug],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function uploadPublicMetadata(books) {
  const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  for (const { metadataPath, metadata } of books) {
    const safeMetadata = { ...metadata };
    delete safeMetadata.studyData;
    const temporaryPath = `${metadataPath}.public-tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(safeMetadata, null, 2)}\n`, 'utf8');
      execFileSync(process.execPath, [wrangler, 'r2', 'object', 'put', `todaku/books/${metadata.slug}/metadata.json`, '--remote', '--file', temporaryPath, '--content-type', 'application/json; charset=utf-8'], {
        cwd: root,
        stdio: 'inherit',
      });
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing. Add it to the ignored root .env file before syncing.');
}

const books = migrateOnly ? [] : await loadBooks();
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set('sslmode', 'verify-full');
const client = new Client({ connectionString: connection.toString() });
try {
  await client.connect();
  await applyMigrations(client);
  if (!migrateOnly) await importBooks(client, books);
  const { rows: bookRows } = await client.query('SELECT COUNT(*)::integer AS count FROM study_books');
  const { rows: vocabRows } = await client.query('SELECT COUNT(*)::integer AS count FROM study_book_vocabulary');
  const { rows: grammarRows } = await client.query('SELECT COUNT(*)::integer AS count FROM study_book_grammar');
  if (migrateOnly) console.log(`Database migrations applied. Database has ${bookRows[0].count} reader(s), ${vocabRows[0].count} per-reader vocabulary records, and ${grammarRows[0].count} per-reader grammar records.`);
  else console.log(`Synced ${books.length} local reader(s). Database now has ${bookRows[0].count} reader(s), ${vocabRows[0].count} per-reader vocabulary records, and ${grammarRows[0].count} per-reader grammar records.`);
} catch (error) {
  const code = error?.code ? ` (Postgres code ${error.code})` : '';
  throw new Error(`PostgreSQL sync failed${code}. Database details are hidden; check DATABASE_URL and migration access.`);
} finally {
  await client.end().catch(() => {});
}

if (upload && !migrateOnly) await uploadPublicMetadata(books);
