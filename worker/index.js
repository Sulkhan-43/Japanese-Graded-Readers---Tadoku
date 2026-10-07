import { getLibrary, readJSON, toLibraryEntry } from './lib/storage.js';
import { getBookStudyIndex, renderBookStudyIndex } from './lib/study-index.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' },
  });
}

function notFound(message = 'Not found.') {
  return json({ error: message }, 404);
}

function isSlug(value) {
  return SLUG_PATTERN.test(value || '') && value.length <= 80;
}

async function getPublishedBook(bucket, slug) {
  if (!isSlug(slug)) return null;
  const metadata = await readJSON(bucket, `books/${slug}/metadata.json`);
  return metadata?.generationStatus === 'completed' ? metadata : null;
}

function replaceMasterIndex(html, markup) {
  const startMarker = '<!-- MASTER-INDEX-START -->';
  const endMarker = '<!-- MASTER-INDEX-END -->';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start < 0 || end <= start) throw new Error('Study guide is missing its master-index markers.');
  return `${html.slice(0, start)}${startMarker}\n${markup}\n${endMarker}${html.slice(end + endMarker.length)}`;
}

async function route(request, env) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/books') {
    const library = await getLibrary(env.BOOKS_BUCKET);
    const books = library.books.filter((book) => book.status === 'completed');
    return json({ books, updatedAt: library.updatedAt });
  }

  const studyIndexMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/study-index$/);
  if (request.method === 'GET' && studyIndexMatch) {
    const slug = decodeURIComponent(studyIndexMatch[1]);
    if (!isSlug(slug)) return notFound('Reader not found.');
    const metadata = await getPublishedBook(env.BOOKS_BUCKET, slug);
    if (!metadata) return notFound('Reader not found.');
    return json(await getBookStudyIndex(env, slug));
  }

  const bookMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
  if (request.method === 'GET' && bookMatch) {
    const book = await getPublishedBook(env.BOOKS_BUCKET, decodeURIComponent(bookMatch[1]));
    return book ? json({ book: toLibraryEntry(book) }) : notFound('Reader not found.');
  }

  const studyMatch = url.pathname.match(/^\/study\/([^/]+)\/?$/);
  if (request.method === 'GET' && studyMatch) {
    const slug = decodeURIComponent(studyMatch[1]);
    const metadata = await getPublishedBook(env.BOOKS_BUCKET, slug);
    if (!metadata) return new Response('Study guide not found', { status: 404 });
    const guide = await env.BOOKS_BUCKET.get(metadata.htmlR2Key);
    if (!guide) return new Response('Study guide not found', { status: 404 });
    const studyIndexMarkup = await renderBookStudyIndex(env, slug);
    const html = replaceMasterIndex(await guide.text(), studyIndexMarkup);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  const coverMatch = url.pathname.match(/^\/assets\/books\/([^/]+)\/cover\/?$/);
  if (request.method === 'GET' && coverMatch) {
    const slug = decodeURIComponent(coverMatch[1]);
    const metadata = await getPublishedBook(env.BOOKS_BUCKET, slug);
    if (!metadata?.coverR2Key) return new Response('Not found', { status: 404 });
    const cover = await env.BOOKS_BUCKET.get(metadata.coverR2Key);
    if (!cover) return new Response('Not found', { status: 404 });
    return new Response(cover.body, {
      headers: {
        'Content-Type': cover.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (url.pathname.startsWith('/api/')) return notFound('API route not found.');
  return new Response('Not found', { status: 404 });
}

export async function handleRequest(request, env) {
  if (!env.BOOKS_BUCKET) return json({ error: 'R2 binding BOOKS_BUCKET is not configured.' }, 503);
  try {
    return await route(request, env);
  } catch (error) {
    console.error('Read request failed:', error?.code || 'storage or database error');
    return json({ error: 'The reader could not be loaded.' }, 500);
  }
}
