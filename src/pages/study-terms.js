import { api } from '../api.js';
import { escapeHTML, setPage } from '../utils.js';

function shell(content) {
  return `<div class="site-shell">
    <header class="site-header"><a class="wordmark" href="/" aria-label="Tadoku home"><img class="wordmark-mark" src="/brand-mark.svg" alt=""><span>Tadoku<small>READER LIBRARY</small></span></a><nav class="header-nav" aria-label="Main navigation"><a href="/">The library</a></nav></header>
    ${content}<footer class="site-footer"><span>A quiet place to read Japanese.</span><span lang="ja">ゆっくり読んで、楽しく学ぼう。</span></footer>
  </div>`;
}

function ruby(segments = [], fallback = '') {
  if (!segments?.length) return escapeHTML(fallback);
  return segments.map((segment) => segment.base
    ? `<ruby>${escapeHTML(segment.base)}<rt>${escapeHTML(segment.reading || '')}</rt></ruby>`
    : escapeHTML(segment.text || '')).join('');
}

function termMarkup(item, kind) {
  const title = kind === 'vocabulary' ? ruby(item.japaneseSegments, item.japanese) : ruby(item.patternSegments, item.pattern);
  const subtitle = kind === 'vocabulary'
    ? `<span class="study-term-detail study-term-reading"><small>${item.romaji ? 'Romaji' : 'Reading'}</small><span>${escapeHTML(item.romaji || item.reading || '')}</span></span><span class="study-term-detail study-term-meaning"><small>English</small><span>${escapeHTML(item.meaning || '')}</span></span>`
    : `<span>${escapeHTML(item.explanation || '')}</span>`;
  return `<article class="study-term-card">
    <div class="study-term-copy"><h3 lang="ja">${title}</h3><div class="study-term-description">${subtitle}</div></div>
    <div class="study-term-count"><strong>${Number(item.occurrences) || 0}</strong><span>encounters</span><small>across ${Number(item.finishedBookCount) || 0} finished ${item.finishedBookCount === 1 ? 'book' : 'books'}</small></div>
    <label class="study-term-toggle"><input type="checkbox" data-term-kind="${kind}" data-term-key="${escapeHTML(item.key)}" ${item.showInReport ? 'checked' : ''}><span>Show in my reports</span></label>
  </article>`;
}

function paginationMarkup(listId, count, pageSize) {
  const pages = Math.ceil(count / pageSize);
  return `<nav class="study-pagination" data-pagination-for="${listId}" aria-label="List pages" ${pages <= 1 ? 'hidden' : ''}>
    <button type="button" data-page-prev aria-label="Previous page" disabled>Previous</button>
    <span data-page-label>Page 1 of ${Math.max(1, pages)}</span>
    <button type="button" data-page-next aria-label="Next page" ${pages <= 1 ? 'disabled' : ''}>Next</button>
  </nav>`;
}

function termPanel(items, kind, label, emptyMessage, pageSize) {
  const visible = items.filter((item) => item.showInReport);
  const hidden = items.length - visible.length;
  const listId = `${kind}-visible`;
  return `<section id="${kind}-panel" role="tabpanel" aria-labelledby="${kind}-tab" class="study-term-panel" ${kind === 'grammar' ? 'hidden' : ''}>
    <div class="study-term-list" id="${listId}" data-visible-terms="${kind}">${visible.length ? visible.map((item) => termMarkup(item, kind)).join('') : `<p class="study-term-empty">${emptyMessage}</p>`}</div>
    ${paginationMarkup(listId, visible.length, pageSize)}
    <a class="study-hidden-link" data-hidden-link="${kind}" href="/${kind}/hidden" ${hidden ? '' : 'hidden'}><span>Hidden ${label.toLowerCase()} <b data-hidden-count="${kind}">(Hidden ${hidden})</b></span><span class="study-hidden-link-action">View hidden ${label.toLowerCase()} <span aria-hidden="true">→</span></span></a>
  </section>`;
}

function hiddenPageMarkup(items, kind, pageSize) {
  const label = kind === 'vocabulary' ? 'Vocabulary' : 'Grammar';
  const listId = `${kind}-hidden`;
  return `<main class="study-terms-page study-hidden-page">
    <a class="study-hidden-back" href="/vocabulary">← Back to vocabulary &amp; grammar</a>
    <section class="study-terms-heading"><div><span class="eyebrow">YOUR STUDY COLLECTION</span><h1>Hidden ${label}</h1><p>These terms stay in your collection but are omitted from your study reports.</p></div><div class="study-terms-total"><strong data-hidden-total>${items.length}</strong><span>hidden items</span></div></section>
    <div class="study-term-list" id="${listId}">${items.length ? items.map((item) => termMarkup(item, kind)).join('') : `<p class="study-term-empty">No hidden ${label.toLowerCase()} items.</p>`}</div>
    ${paginationMarkup(listId, items.length, pageSize)}
    <p class="study-terms-notice" id="study-terms-notice" role="status" aria-live="polite">Use “Show in my reports” to restore a term to your reports.</p>
  </main>`;
}

function setupPagination(listId, pageSize) {
  const list = document.getElementById(listId);
  const nav = document.querySelector(`[data-pagination-for="${listId}"]`);
  if (!list || !nav) return { update() {} };
  let currentPage = 1;
  const render = () => {
    const cards = [...list.querySelectorAll('.study-term-card')];
    const pageCount = Math.max(1, Math.ceil(cards.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    cards.forEach((card, index) => {
      card.hidden = index < (currentPage - 1) * pageSize || index >= currentPage * pageSize;
    });
    nav.hidden = pageCount <= 1;
    nav.querySelector('[data-page-label]').textContent = `Page ${currentPage} of ${pageCount}`;
    nav.querySelector('[data-page-prev]').disabled = currentPage <= 1;
    nav.querySelector('[data-page-next]').disabled = currentPage >= pageCount;
  };
  nav.querySelector('[data-page-prev]').addEventListener('click', () => { currentPage -= 1; render(); });
  nav.querySelector('[data-page-next]').addEventListener('click', () => { currentPage += 1; render(); });
  render();
  return { update: render };
}

function pageMarkup(data, pageSize) {
  const vocab = data.vocabulary || [];
  const grammar = data.grammar || [];
  const visibleCount = [...vocab, ...grammar].filter((item) => item.showInReport).length;
  const hiddenCount = [...vocab, ...grammar].filter((item) => !item.showInReport).length;
  const visibleVocabularyCount = vocab.filter((item) => item.showInReport).length;
  const hiddenVocabularyCount = vocab.length - visibleVocabularyCount;
  const visibleGrammarCount = grammar.filter((item) => item.showInReport).length;
  const hiddenGrammarCount = grammar.length - visibleGrammarCount;
  return `<main class="study-terms-page">
    <section class="study-terms-heading"><div><span class="eyebrow">YOUR STUDY COLLECTION</span><h1>Vocabulary &amp; grammar</h1><p>Terms from your finished books, gathered in one place. Choose what appears in your study reports.</p></div><div class="study-terms-total"><strong data-visible-total>${visibleCount}</strong><span>study items</span><small class="study-terms-hidden-count">(Hidden ${hiddenCount})</small></div></section>
    <div class="study-term-tabs" role="tablist" aria-label="Study terms"><button type="button" role="tab" id="vocabulary-tab" aria-controls="vocabulary-panel" aria-selected="true" data-term-tab="vocabulary">Vocabulary <span class="study-term-tab-count" data-visible-count="vocabulary">${visibleVocabularyCount}</span><small class="study-term-tab-hidden" data-hidden-tab-count="vocabulary">(Hidden ${hiddenVocabularyCount})</small></button><button type="button" role="tab" id="grammar-tab" aria-controls="grammar-panel" aria-selected="false" data-term-tab="grammar">Grammar <span class="study-term-tab-count" data-visible-count="grammar">${visibleGrammarCount}</span><small class="study-term-tab-hidden" data-hidden-tab-count="grammar">(Hidden ${hiddenGrammarCount})</small></button></div>
    ${termPanel(vocab, 'vocabulary', 'Vocabulary', 'Finish a book to collect vocabulary here.', pageSize)}
    ${termPanel(grammar, 'grammar', 'Grammar', 'Grammar notes from finished books will appear here.', pageSize)}
    <p class="study-terms-notice" id="study-terms-notice" role="status" aria-live="polite">Use the hidden-item links to manage terms omitted from reports. Story Japanese is always kept intact.</p>
  </main>`;
}

export async function showStudyTerms(user) {
  if (!user) {
    setPage('Vocabulary & grammar', shell(`<main class="profile-locked"><span class="eyebrow">YOUR STUDY COLLECTION</span><h1>Sign in to see your terms.</h1><p>Your vocabulary and grammar list includes terms from books you have marked Finished.</p><a class="button button-primary" href="/">Back to the library</a><p>Use the login button in the top navigation.</p></main>`));
    return;
  }

  const pageSize = 50;
  setPage('Vocabulary & grammar', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" lang="ja">学</span><p>Gathering terms from finished books…</p></main>'));
  try {
    const data = await api.studyTerms();
    setPage('Vocabulary & grammar', shell(pageMarkup(data, pageSize)));
    const counts = Object.fromEntries(['vocabulary', 'grammar'].map((kind) => {
      const items = data[kind] || [];
      const visible = items.filter((item) => item.showInReport).length;
      return [kind, { visible, hidden: items.length - visible }];
    }));
    const pagers = {
      vocabulary: setupPagination('vocabulary-visible', pageSize),
      grammar: setupPagination('grammar-visible', pageSize),
    };
    const tabs = [...document.querySelectorAll('[data-term-tab]')];
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === tab)));
      document.querySelector('#vocabulary-panel').hidden = tab.dataset.termTab !== 'vocabulary';
      document.querySelector('#grammar-panel').hidden = tab.dataset.termTab !== 'grammar';
    }));

    const notice = document.querySelector('#study-terms-notice');
    for (const checkbox of document.querySelectorAll('[data-term-kind]')) {
      checkbox.addEventListener('change', async () => {
        const kind = checkbox.dataset.termKind;
        checkbox.disabled = true;
        notice.classList.remove('is-error');
        notice.textContent = 'Saving your report preference…';
        try {
          await api.setStudyTermVisibility(kind, checkbox.dataset.termKey, false);
          checkbox.closest('.study-term-card').remove();
          counts[kind].visible -= 1;
          counts[kind].hidden += 1;
          const visibleList = document.querySelector(`[data-visible-terms="${kind}"]`);
          if (!counts[kind].visible) visibleList.innerHTML = `<p class="study-term-empty">All ${kind} items are hidden. Open the hidden ${kind} page below to reveal them.</p>`;
          pagers[kind].update();
          document.querySelector(`[data-visible-count="${kind}"]`).textContent = counts[kind].visible;
          document.querySelector(`[data-hidden-tab-count="${kind}"]`).textContent = `(Hidden ${counts[kind].hidden})`;
          const hiddenLink = document.querySelector(`[data-hidden-link="${kind}"]`);
          hiddenLink.hidden = counts[kind].hidden === 0;
          hiddenLink.querySelector('[data-hidden-count]').textContent = `(Hidden ${counts[kind].hidden})`;
          document.querySelector('[data-visible-total]').textContent = counts.vocabulary.visible + counts.grammar.visible;
          document.querySelector('.study-terms-hidden-count').textContent = `(Hidden ${counts.vocabulary.hidden + counts.grammar.hidden})`;
          notice.textContent = 'This item is hidden from your reports.';
        } catch (error) {
          checkbox.checked = true;
          notice.textContent = error.message;
          notice.classList.add('is-error');
        } finally {
          checkbox.disabled = false;
        }
      });
    }
  } catch (error) {
    setPage('Vocabulary & grammar', shell(`<section class="error-state"><span class="eyebrow">Study collection unavailable</span><h1>We couldn’t load your terms.</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="/vocabulary">Try again</a></section>`));
  }
}

export async function showHiddenStudyTerms(user, kind) {
  if (!['vocabulary', 'grammar'].includes(kind)) {
    window.location.replace('/vocabulary');
    return;
  }
  if (!user) {
    await showStudyTerms(user);
    return;
  }

  const label = kind === 'vocabulary' ? 'Vocabulary' : 'Grammar';
  const pageSize = 50;
  setPage(`Hidden ${label}`, shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" lang="ja">学</span><p>Loading hidden terms…</p></main>'));
  try {
    const data = await api.studyTerms();
    const items = (data[kind] || []).filter((item) => !item.showInReport);
    setPage(`Hidden ${label}`, shell(hiddenPageMarkup(items, kind, pageSize)));
    const listId = `${kind}-hidden`;
    const list = document.getElementById(listId);
    const pager = setupPagination(listId, pageSize);
    const notice = document.querySelector('#study-terms-notice');
    for (const checkbox of document.querySelectorAll('[data-term-kind]')) {
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        notice.classList.remove('is-error');
        notice.textContent = 'Saving your report preference…';
        try {
          await api.setStudyTermVisibility(kind, checkbox.dataset.termKey, true);
          checkbox.closest('.study-term-card').remove();
          const remaining = list.querySelectorAll('.study-term-card').length;
          document.querySelector('[data-hidden-total]').textContent = remaining;
          if (!remaining) list.innerHTML = `<p class="study-term-empty">No hidden ${label.toLowerCase()} items.</p>`;
          pager.update();
          notice.textContent = 'This item will appear in your study reports.';
        } catch (error) {
          checkbox.checked = false;
          notice.textContent = error.message;
          notice.classList.add('is-error');
        } finally {
          checkbox.disabled = false;
        }
      });
    }
  } catch (error) {
    setPage(`Hidden ${label}`, shell(`<section class="error-state"><span class="eyebrow">Study collection unavailable</span><h1>We couldn’t load hidden terms.</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="/vocabulary">Try again</a></section>`));
  }
}
