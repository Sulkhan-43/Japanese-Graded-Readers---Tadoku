# Tadoku Japanese Reader Library

A read-only Cloudflare Pages library of Japanese graded-reader study guides. Guide HTML, covers, and public book details are stored in Cloudflare R2. PostgreSQL is the canonical store for vocabulary, grammar, per-reader counts, and cross-reader totals. The Pages Function queries PostgreSQL through Cloudflare Hyperdrive and renders each guide's final two index tables from those records.

## Storage layout

```text
R2:
  library.json
  books/{slug}/metadata.json       # public book details; excludes studyData
  books/{slug}/study-guide.html    # includes replaceable master-index markers
  books/{slug}/cover.{jpg|png|webp|avif}

Neon PostgreSQL:
  study_books
  study_vocabulary
  study_book_vocabulary
  study_grammar
  study_book_grammar
```

Local `Level{level}-{StoryTitle}.metadata.json` sidecars under `Folders/{level}` are the import files. They retain the study data and counts generated for each reader. The checked-in SQL migration creates normalized records and per-reader joins. Reimporting replaces that reader's rows in a transaction, so occurrence totals do not accumulate on retries.

Set `DATABASE_URL` in the ignored root `.env`. Do not commit it or paste it into chat. To import local readers into Neon:

```sh
npm run update:study-index:db
```

Add `-- --upload` to publish public book metadata to R2 after the import. Study data is omitted from the R2 metadata because the production guide reads it from PostgreSQL.

## Production database connection

The Pages Function uses the `HYPERDRIVE` binding declared in `wrangler.toml`. Hyperdrive connects to Neon using its direct database endpoint. Its ID is stored in Wrangler configuration; credentials remain in Cloudflare's Hyperdrive configuration and the local `.env` file. The public site needs no database password variable.

The guide route replaces the `MASTER-INDEX` marker region in R2 HTML with the current book vocabulary and grammar records, including counts from every imported book. `/api/books/{slug}/study-index` exposes the same data as JSON. The generated R2 HTML remains a standalone fallback when downloaded directly.

## Local development

Requirements: Node.js 20.19+ or 22.12+, dependencies installed, and a Cloudflare account for remote R2 operations.

```sh
npm install
npm run dev:pages
```

The local Pages runtime uses `DATABASE_URL` from `.env` for the Hyperdrive binding override. It uses local R2 storage by default; production R2 is only used when a command explicitly passes `--remote`.

## Deploy

```sh
npm run deploy
```

The deploy script targets the `todaku` Pages project. Its `BOOKS_BUCKET` and `HYPERDRIVE` bindings are defined in `wrangler.toml`.

## Current app scope

- Browse and filter published readers by title and level.
- Open guide pages with Japanese text, readings, translations, vocabulary, grammar, and reading-loupe interactions.
- Serve guide HTML and cover images from R2 while querying vocabulary and grammar indexes from PostgreSQL.
- Keep the Worker API read-only; it has no public upload, OCR, or content-generation routes.
- Future account-based reading progress (unread, in progress, read, hide, and resume) can use the existing PostgreSQL database.
