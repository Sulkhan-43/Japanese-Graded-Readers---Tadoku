import { api } from '../api.js';
import { escapeHTML, setPage } from '../utils.js';

function shell(content) {
  return `<div class="site-shell">
    <header class="site-header"><a class="wordmark" href="/" aria-label="Tadoku home"><span class="wordmark-mark" lang="ja">桜</span><span>Tadoku<small>READER LIBRARY</small></span></a>
      <nav class="header-nav" aria-label="Main navigation"><a class="is-active" href="/">The library</a></nav>
    </header>${content}
    <footer class="site-footer"><span>A quiet place to read Japanese.</span><span lang="ja">ゆっくり読んで、楽しく学ぼう。</span></footer>
  </div>`;
}

function progressSelect(book, status) {
  const values = [['To_Do', 'To do'], ['In_Progress', 'In progress'], ['Finished', 'Finished']];
  return `<label class="reading-status-control"><span class="sr-only">Reading status for ${escapeHTML(book.name)}</span><select data-book-status="${escapeHTML(book.slug)}">${values.map(([value, label]) => `<option value="${value}"${status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function bookCard(book, index, user, statuses) {
  const art = book.coverPath
    ? `<img class="book-cover" src="${escapeHTML(book.coverPath)}" alt="Cover of ${escapeHTML(book.name)}" loading="lazy">`
    : `<div class="cover-art cover-art-${(index % 4) + 1}" aria-hidden="true"><span class="cover-edition">TADOKU · ${escapeHTML(book.level || 'READER')}</span><span class="cover-kanji" lang="ja">${escapeHTML(book.japaneseTitle || '本')}</span><span class="cover-title">${escapeHTML(book.name)}</span><span class="cover-seal" lang="ja">読</span></div>`;
  const status = statuses.get(book.slug) || 'To_Do';
  const statusControl = user
    ? progressSelect(book, status)
    : '<span class="book-status"><i></i>PDF available</span>';
  const studyGuide = user && status === 'Finished'
    ? `<a class="button button-quiet" href="/study/${encodeURIComponent(book.slug)}">Study guide <span aria-hidden="true">↗</span></a>`
    : '';

  return `<article class="book-card" data-reading-status="${status}">
    <a class="cover-link" href="/read/${encodeURIComponent(book.slug)}" aria-label="Read the PDF: ${escapeHTML(book.name)}">${art}</a>
    <div class="book-card-copy"><div class="book-card-top"><span class="eyebrow">${escapeHTML(book.level || 'Unleveled')}</span>${statusControl}</div>
      <h2><a href="/book/${encodeURIComponent(book.slug)}">${escapeHTML(book.name)}</a></h2>
      ${book.japaneseTitle ? `<p class="book-japanese" lang="ja">${escapeHTML(book.japaneseTitle)}</p>` : ''}
      <div class="book-actions"><a class="button button-primary" href="/read/${encodeURIComponent(book.slug)}">Read the PDF <span aria-hidden="true">↗</span></a>${studyGuide}</div>
    </div>
  </article>`;
}

function libraryMarkup(books, user, progress) {
  const statuses = new Map((progress?.books || []).map((entry) => [entry.slug, entry.status]));
  const levels = [...new Set(books.map((book) => book.level).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const control = books.length ? `<div class="library-tools"><label class="search-field"><span class="sr-only">Search books</span><span class="search-icon" aria-hidden="true">⌕</span><input id="book-search" type="search" placeholder="Find a story" autocomplete="off"></label>
    <label class="select-field"><span class="sr-only">Filter by level</span><select id="level-filter"><option value="">All levels</option>${levels.map((level) => `<option value="${escapeHTML(level)}">${escapeHTML(level)}</option>`).join('')}</select></label>
    <span class="book-count"><strong id="visible-count">${books.length}</strong> ${books.length === 1 ? 'reader' : 'readers'}</span></div>` : '';
  const cards = books.length
    ? `<div id="book-grid" class="book-grid">${books.map((book, index) => bookCard(book, index, user, statuses)).join('')}</div><p id="no-filter-results" class="filter-empty" hidden>No readers match those filters.</p>`
    : `<section class="empty-state"><div class="empty-stamp" aria-hidden="true" lang="ja">読</div><span class="eyebrow">A quiet new shelf</span><h2>Readers will appear here.</h2><p>Come back when the next book is ready.</p></section>`;
  const accountNote = user
    ? `<a class="reading-summary-link" href="/profile">${progress?.totals?.Finished || 0} finished · ${progress?.totals?.In_Progress || 0} in progress <span aria-hidden="true">↗</span></a>`
    : '';

  return `<main><section class="library-intro"><div class="intro-copy"><span class="eyebrow"><span class="eyebrow-dot"></span> Japanese, at your own pace</span><h1>Read a little.<br><em>Understand more.</em></h1><p>Pick a graded reader, settle in with the original Japanese, and keep your place as you go.</p>${accountNote}</div>
    <div class="intro-aside"><div class="aside-rule"></div><p class="aside-japanese" lang="ja">桜を見れば、<br>春が近づく。</p><span>READ MORE · ONE PAGE AT A TIME</span></div></section>
    <section class="library-section" aria-labelledby="shelf-title"><div class="section-heading"><div><span class="eyebrow">THE COLLECTION</span><h2 id="shelf-title">Stories for your next reading session</h2></div><span class="collection-count">${String(books.length).padStart(2, '0')} <span>IN THE LIBRARY</span></span></div>${control}${cards}</section></main>`;
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

function bindProgressControls() {
  for (const select of document.querySelectorAll('[data-book-status]')) {
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api.setProgress(select.dataset.bookStatus, select.value);
        window.location.reload();
      } catch (error) {
        window.alert(error.message);
        select.disabled = false;
      }
    });
  }
}

export async function showLibrary(user) {
  setPage('Japanese Reader Library', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" aria-hidden="true" lang="ja">読</span><p>Opening the library…</p></main>'));
  try {
    const [{ books }, progress] = await Promise.all([
      api.books(),
      user ? api.progress() : Promise.resolve(null),
    ]);
    setPage('Japanese Reader Library', shell(libraryMarkup(books || [], user, progress)));
    bindFilters();
    bindProgressControls();
  } catch (error) {
    setPage('Japanese Reader Library', shell(`<section class="error-state"><span class="eyebrow">The shelf is unavailable</span><h1>We couldn’t open the library.</h1><p>${escapeHTML(error.message)}</p><button class="button button-primary" id="retry-library">Try again</button></section>`));
    document.querySelector('#retry-library').addEventListener('click', () => showLibrary(user));
  }
}

export async function showBook(slug, user) {
  setPage('Reader', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" aria-hidden="true" lang="ja">読</span><p>Finding this reader…</p></main>'));
  try {
    const [{ book }, progress] = await Promise.all([
      api.book(slug),
      user ? api.progress() : Promise.resolve(null),
    ]);
    const status = progress?.books?.find((entry) => entry.slug === book.slug)?.status || 'To_Do';
    const statusText = status === 'Finished' ? 'Study guide unlocked' : 'Original Japanese PDF';
    const actions = `<a class="button button-primary" href="/read/${encodeURIComponent(book.slug)}">Read the PDF <span aria-hidden="true">↗</span></a>${user && status === 'Finished' ? `<a class="button button-secondary" href="/study/${encodeURIComponent(book.slug)}">Open study guide <span aria-hidden="true">↗</span></a>` : ''}`;
    const cover = book.coverPath
      ? `<img class="detail-cover" src="${escapeHTML(book.coverPath)}" alt="Cover of ${escapeHTML(book.name)}">`
      : `<div class="detail-cover cover-art cover-art-2" aria-hidden="true"><span class="cover-kanji" lang="ja">${escapeHTML(book.japaneseTitle || '本')}</span></div>`;
    const lockedNote = new URLSearchParams(window.location.search).has('locked')
      ? `<p class="access-note">${user ? 'Finish this reader to unlock its translated study guide.' : 'Sign in and mark this reader finished to unlock its study guide.'}</p>`
      : '';
    const statusControl = user
      ? progressSelect(book, status)
      : '<p class="access-note">Sign in to save your reading status. The original PDF is available to everyone.</p>';
    const markup = `<main class="book-detail"><a class="back-link" href="/">← Back to the library</a><div class="detail-layout" data-reading-status="${status}">${cover}<section class="detail-copy"><span class="eyebrow">${escapeHTML(book.level || 'Unleveled')} · ${statusText}</span><h1>${escapeHTML(book.name)}</h1>${book.japaneseTitle ? `<p class="book-japanese" lang="ja">${escapeHTML(book.japaneseTitle)}</p>` : ''}<div class="detail-status">${statusControl}</div>${lockedNote}<div class="detail-actions">${actions}</div></section></div></main>`;
    setPage(book.name, shell(markup));
    bindProgressControls();
  } catch (error) {
    setPage('Reader not found', shell(`<section class="error-state"><span class="eyebrow">404 · Reader not found</span><h1>This story isn’t on the shelf.</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="/">Return to the library</a></section>`));
  }
}
