import { api } from '../api.js';
import { escapeHTML, setPage } from '../utils.js';

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function shell(content) {
  return `<div class="site-shell">
    <header class="site-header"><a class="wordmark" href="/" aria-label="Tadoku home"><span class="wordmark-mark" lang="ja">読</span><span>Tadoku<small>READER LIBRARY</small></span></a>
      <nav class="header-nav" aria-label="Main navigation"><a class="is-active" href="/">The library</a></nav>
    </header>${content}
    <footer class="site-footer"><span>A quiet place to read Japanese.</span><span>一ページずつ、楽しく。</span></footer>
  </div>`;
}

function bookCard(book, index) {
  const art = book.coverPath
    ? `<img class="book-cover" src="${escapeHTML(book.coverPath)}" alt="Cover of ${escapeHTML(book.name)}" loading="lazy">`
    : `<div class="cover-art cover-art-${(index % 4) + 1}" aria-hidden="true"><span class="cover-edition">TADOKU · ${escapeHTML(book.level || 'READER')}</span><span class="cover-kanji" lang="ja">${escapeHTML(book.japaneseTitle || '本')}</span><span class="cover-title">${escapeHTML(book.name)}</span><span class="cover-seal" lang="ja">読</span></div>`;
  const original = externalUrl(book.originalUrl);
  return `<article class="book-card">
    <a class="cover-link" href="/book/${encodeURIComponent(book.slug)}" aria-label="View ${escapeHTML(book.name)}">${art}</a>
    <div class="book-card-copy"><div class="book-card-top"><span class="eyebrow">${escapeHTML(book.level || 'Unleveled')}</span><span class="book-status is-ready"><i></i>Study guide ready</span></div>
      <h2><a href="/book/${encodeURIComponent(book.slug)}">${escapeHTML(book.name)}</a></h2>
      ${book.japaneseTitle ? `<p class="book-japanese" lang="ja">${escapeHTML(book.japaneseTitle)}</p>` : ''}
      ${book.description ? `<p class="book-description">${escapeHTML(book.description)}</p>` : ''}
      <div class="book-actions"><a class="button button-primary" href="/study/${encodeURIComponent(book.slug)}" target="_blank" rel="noopener noreferrer">Open study guide <span aria-hidden="true">↗</span></a>
        ${original ? `<a class="button button-quiet" href="${escapeHTML(original)}" target="_blank" rel="noopener noreferrer">Original book <span aria-hidden="true">↗</span></a>` : ''}</div>
    </div>
  </article>`;
}

function libraryMarkup(books) {
  const levels = [...new Set(books.map((book) => book.level).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const control = books.length ? `<div class="library-tools"><label class="search-field"><span class="sr-only">Search books</span><span class="search-icon" aria-hidden="true">⌕</span><input id="book-search" type="search" placeholder="Find a story" autocomplete="off"></label>
    <label class="select-field"><span class="sr-only">Filter by level</span><select id="level-filter"><option value="">All levels</option>${levels.map((level) => `<option value="${escapeHTML(level)}">${escapeHTML(level)}</option>`).join('')}</select></label>
    <span class="book-count"><strong id="visible-count">${books.length}</strong> ${books.length === 1 ? 'reader' : 'readers'}</span></div>` : '';
  const cards = books.length
    ? `<div id="book-grid" class="book-grid">${books.map(bookCard).join('')}</div><p id="no-filter-results" class="filter-empty" hidden>No readers match those filters.</p>`
    : `<section class="empty-state"><div class="empty-stamp" aria-hidden="true" lang="ja">読</div><span class="eyebrow">A quiet new shelf</span><h2>Study guides will appear here.</h2><p>Come back when the next reader is ready.</p></section>`;

  return `<main><section class="library-intro"><div class="intro-copy"><span class="eyebrow"><span class="eyebrow-dot"></span> Japanese, at your own pace</span><h1>Read a little.<br><em>Understand more.</em></h1><p>Graded readers with Japanese text, romaji, natural translations, and notes for the details worth noticing.</p></div>
    <div class="intro-aside"><div class="aside-rule"></div><p class="aside-japanese" lang="ja">読めば、<br>わかることが増える。</p><span>READ MORE · UNDERSTAND MORE</span></div></section>
    <section class="library-section" aria-labelledby="shelf-title"><div class="section-heading"><div><span class="eyebrow">THE COLLECTION</span><h2 id="shelf-title">Stories for your next study session</h2></div><span class="collection-count">${String(books.length).padStart(2, '0')} <span>IN THE LIBRARY</span></span></div>${control}${cards}</section></main>`;
}

function bindFilters() {
  const search = document.querySelector('#book-search');
  const level = document.querySelector('#level-filter');
  if (!search || !level) return;
  const cards = [...document.querySelectorAll('.book-card')];
  const count = document.querySelector('#visible-count');
  const empty = document.querySelector('#no-filter-results');
  const update = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      const matches = card.textContent.toLowerCase().includes(query) && (!level.value || card.querySelector('.eyebrow').textContent === level.value);
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    count.textContent = String(visible);
    empty.hidden = visible > 0;
  };
  search.addEventListener('input', update);
  level.addEventListener('change', update);
}

export async function showLibrary() {
  setPage('Japanese Reader Library', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" aria-hidden="true" lang="ja">読</span><p>Opening the library…</p></main>'));
  try {
    const { books } = await api.books();
    setPage('Japanese Reader Library', shell(libraryMarkup(books || [])));
    bindFilters();
  } catch (error) {
    setPage('Japanese Reader Library', shell(`<section class="error-state"><span class="eyebrow">The shelf is unavailable</span><h1>We couldn’t open the library.</h1><p>${escapeHTML(error.message)}</p><button class="button button-primary" id="retry-library">Try again</button></section>`));
    document.querySelector('#retry-library').addEventListener('click', showLibrary);
  }
}

export async function showBook(slug) {
  setPage('Reader', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" aria-hidden="true" lang="ja">読</span><p>Finding this reader…</p></main>'));
  try {
    const { book } = await api.book(slug);
    const original = externalUrl(book.originalUrl);
    const actions = `<a class="button button-primary" href="/study/${encodeURIComponent(book.slug)}" target="_blank" rel="noopener noreferrer">Open study guide <span aria-hidden="true">↗</span></a>${original ? `<a class="button button-quiet" href="${escapeHTML(original)}" target="_blank" rel="noopener noreferrer">View original book <span aria-hidden="true">↗</span></a>` : ''}`;
    const cover = book.coverPath ? `<img class="detail-cover" src="${escapeHTML(book.coverPath)}" alt="Cover of ${escapeHTML(book.name)}">` : `<div class="detail-cover cover-art cover-art-2" aria-hidden="true"><span class="cover-kanji" lang="ja">${escapeHTML(book.japaneseTitle || '本')}</span></div>`;
    setPage(book.name, shell(`<main class="book-detail"><a class="back-link" href="/">← Back to the library</a><div class="detail-layout">${cover}<section class="detail-copy"><span class="eyebrow">${escapeHTML(book.level || 'Unleveled')}</span><h1>${escapeHTML(book.name)}</h1>${book.japaneseTitle ? `<p class="book-japanese" lang="ja">${escapeHTML(book.japaneseTitle)}</p>` : ''}<p>${escapeHTML(book.description || 'A Japanese reader ready for a thoughtful study session.')}</p><div class="detail-actions">${actions}</div></section></div></main>`));
  } catch (error) {
    setPage('Reader not found', shell(`<section class="error-state"><span class="eyebrow">404 · Reader not found</span><h1>This story isn’t on the shelf.</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="/">Return to the library</a></section>`));
  }
}
