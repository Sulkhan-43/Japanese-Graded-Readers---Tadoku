# Tadoku Japanese Reader Library

A read-only Cloudflare Pages library for published Japanese graded-reader study guides. Book metadata and guide HTML are stored in Cloudflare R2 and served by Pages Functions. The site does not process PDFs or call an AI service.

## R2 layout

```text
library.json
books/{slug}/metadata.json
books/{slug}/study-guide.html
books/{slug}/cover.{jpg|png|webp|avif}
```

The library index lists published readers. A book is public when its metadata has `generationStatus: "completed"`; the Worker serves its self-contained HTML at `/study/{slug}` and its cover at `/assets/books/{slug}/cover`.

## Current app scope

- Browse and filter published guides by title and level.
- Open a reader details page or its study guide.
- Serve guide HTML and cover images from R2.
- The Worker exposes read-only routes. It has no admin, upload, OCR, or generation endpoints.

The source PDFs already in `Folders/0` through `Folders/5` are unchanged. The proposed local folder processor and automatic R2 publishing workflow are not implemented yet.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and a Cloudflare account for deployment.

```sh
npm install
npm run dev:pages
```

Wrangler serves the Pages app locally at the URL it prints (usually `http://localhost:8788`). By default, local R2 data is separate from the live bucket.

## Deploy

Create the `todaku` and `todaku-dev` R2 buckets, then deploy the Pages project:

```sh
npx wrangler r2 bucket create todaku
npx wrangler r2 bucket create todaku-dev
npm run deploy
```

The deploy script targets the `todaku` Pages project. Its `BOOKS_BUCKET` R2 binding is declared in `wrangler.toml`. Published study guides must already be present in R2 using the layout above.
