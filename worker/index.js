import { getLibrary, readJSON, toLibraryEntry } from './lib/storage.js';
import {
  filterUserHiddenStudyNotes,
  getBookStudyIndex,
  getFinishedStudyTerms,
  renderBookStudyIndex,
  setStudyTermVisibility,
} from './lib/study-index.js';
import {
  AuthError,
  bookIsFinished,
  createAccount,
  currentUser,
  lookupPasswordHint,
  login,
  logout,
  readingProgress,
  updateReadingProgress,
} from './lib/auth.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STUDY_GUIDE_LANGUAGE_STYLES = `
/* TADOKU-GUIDE-LANGUAGE-STYLES */
.romaji,
.translation {
  display: block;
  box-sizing: border-box;
  margin: .65rem 0;
  padding: .65rem .8rem;
  border-left: 3px solid;
  border-radius: 0 .4rem .4rem 0;
}
.romaji {
  border-color: #73927a;
  background: #eef3ed;
  color: #315f3d;
  font-size: .94rem;
  font-style: italic;
  line-height: 1.65;
}
.translation {
  border-color: #c76b4d;
  background: #fbf1e9;
  color: #754522;
  font-size: .98rem;
  line-height: 1.65;
}
.line-label {
  display: block;
  margin-bottom: .15rem;
  font: 600 .62rem/1.3 ui-monospace, monospace;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.romaji .line-label { color: #607a68; }
.translation .line-label { color: #b15c2a; }
@media (max-width: 560px) {
  .romaji, .translation { padding: .55rem .65rem; }
}
`;

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': status >= 400 ? 'no-store' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function privateJson(data, status = 200, extraHeaders = {}) {
  return json(data, status, { 'Cache-Control': 'private, no-store', ...extraHeaders });
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

function presentStudyGuideLanguages(html) {
  let output = html;
  if (!output.includes('TADOKU-GUIDE-LANGUAGE-STYLES')) {
    let inserted = false;
    output = output.replace(/<\/style\s*>/i, (closingTag) => {
      inserted = true;
      return `${STUDY_GUIDE_LANGUAGE_STYLES}\n${closingTag}`;
    });
    if (!inserted) {
      const styleElement = `<style>${STUDY_GUIDE_LANGUAGE_STYLES}</style>`;
      output = /<\/head\s*>/i.test(output)
        ? output.replace(/<\/head\s*>/i, `${styleElement}</head>`)
        : `${styleElement}${output}`;
    }
  }

  const labels = [
    ['romaji', 'Romaji'],
    ['translation', 'English'],
  ];
  for (const [className, label] of labels) {
    const openingTag = new RegExp(`(<(?:p|div)\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>)(?!\\s*<span\\b[^>]*\\bclass="[^"]*\\bline-label\\b[^"]*"[^>]*>)`, 'gi');
    output = output.replace(openingTag, `$1<span class="line-label">${label}</span>`);
  }
  return output;
}

function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new AuthError('Request origin could not be verified.', 403);
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') throw new AuthError('Request origin could not be verified.', 403);
}

async function readJsonBody(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new AuthError('Send this request as JSON.', 415);
  }
  try {
    return await request.json();
  } catch {
    throw new AuthError('Request body is not valid JSON.');
  }
}

function authResponse(result, status = 200) {
  return privateJson({ user: result.user }, status, { 'Set-Cookie': result.cookie });
}

function redirectToBook(request, slug) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(`/book/${encodeURIComponent(slug)}?locked=1`, request.url).href,
      'Cache-Control': 'private, no-store',
    },
  });
}

async function route(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    return privateJson({ user: await currentUser(request, env) });
  }

  if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
    requireSameOrigin(request);
    return authResponse(await createAccount(request, env, await readJsonBody(request)), 201);
  }

  if (url.pathname === '/api/auth/password-hint' && request.method === 'POST') {
    requireSameOrigin(request);
    return privateJson(await lookupPasswordHint(request, env, await readJsonBody(request)));
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    requireSameOrigin(request);
    return authResponse(await login(request, env, await readJsonBody(request)));
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    requireSameOrigin(request);
    return privateJson({ ok: true }, 200, { 'Set-Cookie': await logout(request, env) });
  }

  if (url.pathname === '/api/progress' && request.method === 'GET') {
    const user = await currentUser(request, env);
    if (!user) return privateJson({ error: 'Sign in to view your reading progress.' }, 401);
    return privateJson(await readingProgress(env, user.id));
  }

  if (url.pathname === '/api/study-terms' && request.method === 'GET') {
    const user = await currentUser(request, env);
    if (!user) return privateJson({ error: 'Sign in to view your vocabulary and grammar.' }, 401);
    return privateJson(await getFinishedStudyTerms(env, user.id));
  }

  if (url.pathname === '/api/study-terms' && request.method === 'PATCH') {
    requireSameOrigin(request);
    const user = await currentUser(request, env);
    if (!user) return privateJson({ error: 'Sign in to change your report preferences.' }, 401);
    const { kind, key, showInReport } = await readJsonBody(request);
    try {
      return privateJson({ preference: await setStudyTermVisibility(env, user.id, kind, key, showInReport) });
    } catch (error) {
      if (error?.message === 'This item is not part of a finished book on your shelf.') {
        throw new AuthError(error.message, 404);
      }
      if (error?.message === 'Choose a vocabulary or grammar item.'
        || error?.message === 'Study term key is invalid.'
        || error?.message === 'Choose whether this item appears in reports.') {
        throw new AuthError(error.message, 400);
      }
      throw error;
    }
  }

  const progressMatch = url.pathname.match(/^\/api\/progress\/([^/]+)$/);
  if (progressMatch && request.method === 'PATCH') {
    requireSameOrigin(request);
    const user = await currentUser(request, env);
    if (!user) return privateJson({ error: 'Sign in to save your reading progress.' }, 401);
    const slug = decodeURIComponent(progressMatch[1]);
    if (!isSlug(slug) || !(await getPublishedBook(env.BOOKS_BUCKET, slug))) return notFound('Reader not found.');
    const { status } = await readJsonBody(request);
    return privateJson({ progress: await updateReadingProgress(env, user.id, slug, status) });
  }

  if (request.method === 'GET' && url.pathname === '/api/books') {
    const library = await getLibrary(env.BOOKS_BUCKET);
    const books = library.books.filter((book) => book.status === 'completed').map((book) => ({
      id: book.id || book.slug,
      name: book.name,
      japaneseTitle: book.japaneseTitle || '',
      slug: book.slug,
      level: book.level || 'Unleveled',
      coverPath: book.coverPath || null,
      pdfPath: `/pdf/${book.slug}`,
      status: book.status,
    }));
    return json({ books, updatedAt: library.updatedAt });
  }

  const studyIndexMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/study-index$/);
  if (request.method === 'GET' && studyIndexMatch) {
    const slug = decodeURIComponent(studyIndexMatch[1]);
    if (!isSlug(slug)) return notFound('Reader not found.');
    const user = await currentUser(request, env);
    if (!user || !(await bookIsFinished(env, user.id, slug))) return notFound('Reader not found.');
    const metadata = await getPublishedBook(env.BOOKS_BUCKET, slug);
    if (!metadata) return notFound('Reader not found.');
    return privateJson(await getBookStudyIndex(env, slug, user.id));
  }

  const bookMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
  if (request.method === 'GET' && bookMatch) {
    const book = await getPublishedBook(env.BOOKS_BUCKET, decodeURIComponent(bookMatch[1]));
    return book ? json({ book: toLibraryEntry(book) }) : notFound('Reader not found.');
  }

  const studyMatch = url.pathname.match(/^\/study\/([^/]+)\/?$/);
  if (request.method === 'GET' && studyMatch) {
    const slug = decodeURIComponent(studyMatch[1]);
    const user = await currentUser(request, env);
    if (!user || !(await bookIsFinished(env, user.id, slug))) return redirectToBook(request, slug);
    const metadata = await getPublishedBook(env.BOOKS_BUCKET, slug);
    if (!metadata) return new Response('Study guide not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const guide = await env.BOOKS_BUCKET.get(metadata.htmlR2Key);
    if (!guide) return new Response('Study guide not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const sourceHtml = await guide.text();
    const filteredHtml = await filterUserHiddenStudyNotes(env, slug, user.id, sourceHtml);
    const studyIndexMarkup = await renderBookStudyIndex(env, slug, user.id);
    const styledHtml = presentStudyGuideLanguages(filteredHtml);
    const html = replaceMasterIndex(styledHtml, studyIndexMarkup);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const pdfMatch = url.pathname.match(/^\/pdf\/([^/]+)\/?$/);
  if (request.method === 'GET' && pdfMatch) {
    const slug = decodeURIComponent(pdfMatch[1]);
    if (!isSlug(slug)) return notFound('Reader not found.');
    const metadata = await getPublishedBook(env.BOOKS_BUCKET, slug);
    if (!metadata) return notFound('Reader not found.');
    const pdfKey = metadata.pdfR2Key || metadata.sourcePdfR2Key || `books/${slug}/source.pdf`;
    const pdf = await env.BOOKS_BUCKET.get(pdfKey);
    if (!pdf) return notFound('PDF not found.');
    return new Response(pdf.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${slug}.pdf"`,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
        'Content-Length': String(pdf.size),
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
    if (error instanceof AuthError) return json({ error: error.message }, error.status);
    console.error('Read request failed:', error?.code || 'storage or database error');
    return json({ error: 'The reader could not be loaded.' }, 500);
  }
}
