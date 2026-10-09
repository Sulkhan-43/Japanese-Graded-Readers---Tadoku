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
  startReadingProgress,
  updateReadingProgress,
} from './lib/auth.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STUDY_GUIDE_LANGUAGE_STYLES = `
/* TADOKU-GUIDE-LANGUAGE-STYLES */
.study-guide-navigation {
  width: min(1040px, calc(100% - 32px));
  margin: 16px auto -12px;
}
.study-guide-back {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 .8rem;
  border: 1px solid #d9ddd4;
  border-radius: 999px;
  background: #fffefa;
  color: #426b50;
  font: 600 .72rem/1.2 ui-monospace, monospace;
  text-decoration: none;
}
.study-guide-back:hover { border-color: #9caf9b; background: #edf3eb; }
.study-guide-back:focus-visible,
.study-index-hide:focus-visible { outline: 2px solid #426b50; outline-offset: 2px; }
.study-index-preference-note {
  margin: 0 0 12px;
  color: #6f7c72;
  font: 12px/1.6 Arial, sans-serif;
}
.study-index-status:not(:empty) {
  margin: 0 0 12px;
  padding: .55rem .75rem;
  border-left: 2px solid #73927a;
  background: #eef3ed;
  color: #315f3d;
  font: 12px/1.5 Arial, sans-serif;
}
.study-index-status[data-state="error"] {
  border-color: #ae573e;
  background: #fbf1e9;
  color: #754522;
}
.study-index-hide {
  min-width: 44px;
  min-height: 44px;
  padding: .4rem .7rem;
  border: 1px solid #dfc6bd;
  border-radius: 999px;
  background: #fff8f4;
  color: #8b4938;
  cursor: pointer;
  font: 600 .65rem/1.2 ui-monospace, monospace;
}
.study-index-hide:hover { border-color: #c76b4d; background: #fbf1e9; }
.study-index-hide:disabled { cursor: wait; opacity: .7; }
.index-card {
  margin: 20px 0;
  padding: 16px;
  border: 1px solid #d9ddd4;
  background: #fffefa;
}
.index-card-head h2 { margin: 0 0 5px; font: 500 21px/1.2 Georgia, serif; }
.index-card-head p { margin: 0 0 12px; color: #6f7c72; font: 12px/1.55 Arial, sans-serif; }
.index-table-wrap,
.table-scroll,
.table-wrap {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
}
.index-table-wrap table,
.table-scroll table,
.table-wrap table { min-width: 620px; }
.index-table-wrap .grammar-table { min-width: 550px; }
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
  font-family: ui-monospace, monospace;
  font-size: .94rem;
  font-weight: 500;
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
.guide-note-romaji {
  color: #315f3d;
  font-family: ui-monospace, monospace;
  font-size: .9em;
  font-weight: 600;
}
.guide-note-meaning { color: #754522; font-weight: 500; }
@media (max-width: 560px) {
  .study-guide-navigation { width: calc(100% - 24px); margin: 8px auto 0; }
  .report { width: calc(100% - 20px); margin: 10px auto 36px; }
  .report-header { padding: 21px 16px; }
  .report-header h1 { font-size: clamp(30px, 9vw, 42px); overflow-wrap: anywhere; }
  .report-header .japanese-title { font-size: 21px; line-height: 1.7; }
  .synopsis { padding: 16px; }
  .passage-card { margin: 13px 0; }
  .passage-card > header { align-items: flex-start; flex-wrap: wrap; padding: 9px 12px; }
  .passage-content { padding: 16px 13px 12px; }
  .jp { font-size: clamp(21px, 6vw, 25px); line-height: 2.05; overflow-wrap: anywhere; }
  .jp rt { font-size: 10px; line-height: 1.15; }
  .romaji, .translation { padding: .55rem .65rem; font-size: 15px; }
  .study-notes { grid-template-columns: 1fr; padding: 0 10px 12px; }
  .notes { padding: 11px; }
  .notes ul { font-size: 13px; line-height: 1.65; }
  .master-index { margin-top: 27px; }
  .index-card { margin: 15px 0; padding: 12px; }
  .index-card-head h2 { font-size: 18px; }
  .index-card-head p { font-size: 11px; }
  th, td { padding: 7px 8px; }
}
`;

const STUDY_INDEX_HIDE_SCRIPT = `(() => {
  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-study-index-hide]');
    if (!button || button.disabled) return;

    const status = document.querySelector('[data-study-index-status]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Saving…';
    if (status) {
      status.removeAttribute('data-state');
      status.textContent = 'Saving this preference…';
    }

    try {
      const response = await fetch('/api/study-terms', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: button.dataset.studyTermKind,
          key: button.dataset.studyTermKey,
          showInReport: false
        })
      });
      let result = {};
      try { result = await response.json(); } catch {}
      if (!response.ok) throw new Error(result.error || 'Could not hide this item.');
      if (status) status.textContent = 'Hidden from all of your study reports. Refreshing this guide…';
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      if (status) {
        status.dataset.state = 'error';
        status.textContent = error.message || 'Could not hide this item.';
      }
    }
  });
})();`;

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

function createScriptNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function addStudyGuideControls(html, slug, nonce) {
  const backLink = `<nav class="study-guide-navigation" aria-label="Study guide navigation"><a class="study-guide-back" href="/book/${encodeURIComponent(slug)}">← Back to this book</a></nav>`;
  let output = html.replace(/<body\b[^>]*>/i, (openingTag) => `${openingTag}${backLink}`);
  if (output === html) output = `${backLink}${output}`;
  const script = `<script nonce="${nonce}">${STUDY_INDEX_HIDE_SCRIPT}</script>`;
  return output.replace(/<\/body\s*>/i, `${script}</body>`);
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
  output = output.replace(/(\([A-Za-zÀ-ž][^()<>]*\))(?=<span\b[^>]*\bclass="[^"]*\bjp-loupe\b|<\/strong>)/gi, '<span class="guide-note-romaji">$1</span>');
  output = output.replace(/(<\/strong>\s*[—–]\s*)([^<]+)(?=<\/li>)/gi, '$1<span class="guide-note-meaning">$2</span>');
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
  const startProgressMatch = url.pathname.match(/^\/api\/progress\/([^/]+)\/start$/);
  if (request.method === 'POST' && startProgressMatch) {
    requireSameOrigin(request);
    const user = await currentUser(request, env);
    if (!user) return privateJson({ error: 'Sign in to save your reading progress.' }, 401);
    const slug = decodeURIComponent(startProgressMatch[1]);
    if (!isSlug(slug) || !(await getPublishedBook(env.BOOKS_BUCKET, slug))) return notFound('Reader not found.');
    await readJsonBody(request);
    return privateJson({ progress: await startReadingProgress(env, user.id, slug) });
  }

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
      wordCount: Number.isInteger(book.wordCount) && book.wordCount >= 0 ? book.wordCount : 0,
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
    const nonce = createScriptNonce();
    const html = addStudyGuideControls(replaceMasterIndex(styledHtml, studyIndexMarkup), slug, nonce);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
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
