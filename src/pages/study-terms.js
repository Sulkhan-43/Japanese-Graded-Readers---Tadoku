import { api } from '../api.js';
import { escapeHTML, setPage } from '../utils.js';

function shell(content) {
  return `<div class="site-shell">
    <header class="site-header"><a class="wordmark" href="/" aria-label="Tadoku home"><span class="wordmark-mark" lang="ja">桜</span><span>Tadoku<small>READER LIBRARY</small></span></a><nav class="header-nav" aria-label="Main navigation"><a href="/">The library</a></nav></header>
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
    ? `<span class="study-term-reading">${escapeHTML(item.romaji || item.reading || '')}</span><span>${escapeHTML(item.meaning || '')}</span>`
    : `<span>${escapeHTML(item.explanation || '')}</span>`;
  const label = kind === 'vocabulary' ? 'Vocabulary' : 'Grammar';
  return `<article class="study-term-card">
    <div class="study-term-copy"><h3 lang="ja">${title}</h3><div class="study-term-description">${subtitle}</div></div>
    <div class="study-term-count"><strong>${Number(item.occurrences) || 0}</strong><span>encounters</span><small>across ${Number(item.finishedBookCount) || 0} finished ${item.finishedBookCount === 1 ? 'book' : 'books'}</small></div>
    <label class="study-term-toggle"><input type="checkbox" data-term-kind="${kind}" data-term-key="${escapeHTML(item.key)}" ${item.showInReport ? 'checked' : ''}><span>Show in my reports</span></label>
  </article>`;
}

function pageMarkup(data) {
  const vocab = data.vocabulary || [];
  const grammar = data.grammar || [];
  return `<main class="study-terms-page">
    <section class="study-terms-heading"><div><span class="eyebrow">YOUR STUDY COLLECTION</span><h1>Vocabulary &amp; grammar</h1><p>Terms from your finished books, gathered in one place. Choose what appears in your study reports.</p></div><div class="study-terms-total"><strong>${vocab.length + grammar.length}</strong><span>study items</span></div></section>
    <p class="study-terms-notice" id="study-terms-notice" role="status" aria-live="polite">Your choices apply to your account. Story Japanese is always kept intact.</p>
    <div class="study-term-tabs" role="tablist" aria-label="Study terms"><button type="button" role="tab" id="vocabulary-tab" aria-controls="vocabulary-panel" aria-selected="true" data-term-tab="vocabulary">Vocabulary <span>${vocab.length}</span></button><button type="button" role="tab" id="grammar-tab" aria-controls="grammar-panel" aria-selected="false" data-term-tab="grammar">Grammar <span>${grammar.length}</span></button></div>
    <section id="vocabulary-panel" role="tabpanel" aria-labelledby="vocabulary-tab" class="study-term-list">${vocab.length ? vocab.map((item) => termMarkup(item, 'vocabulary')).join('') : '<p class="study-term-empty">Finish a book to collect vocabulary here.</p>'}</section>
    <section id="grammar-panel" role="tabpanel" aria-labelledby="grammar-tab" class="study-term-list" hidden>${grammar.length ? grammar.map((item) => termMarkup(item, 'grammar')).join('') : '<p class="study-term-empty">Grammar notes from finished books will appear here.</p>'}</section>
  </main>`;
}

export async function showStudyTerms(user) {
  if (!user) {
    setPage('Vocabulary & grammar', shell(`<main class="profile-locked"><span class="eyebrow">YOUR STUDY COLLECTION</span><h1>Sign in to see your terms.</h1><p>Your vocabulary and grammar list includes terms from books you have marked Finished.</p><a class="button button-primary" href="/">Back to the library</a><p>Use the “Log in / Sign up” button in the top navigation.</p></main>`));
    return;
  }

  setPage('Vocabulary & grammar', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" lang="ja">学</span><p>Gathering terms from finished books…</p></main>'));
  try {
    const data = await api.studyTerms();
    setPage('Vocabulary & grammar', shell(pageMarkup(data)));
    const tabs = [...document.querySelectorAll('[data-term-tab]')];
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === tab)));
      document.querySelector('#vocabulary-panel').hidden = tab.dataset.termTab !== 'vocabulary';
      document.querySelector('#grammar-panel').hidden = tab.dataset.termTab !== 'grammar';
    }));
    const notice = document.querySelector('#study-terms-notice');
    for (const checkbox of document.querySelectorAll('[data-term-kind]')) {
      checkbox.addEventListener('change', async () => {
        const previous = !checkbox.checked;
        checkbox.disabled = true;
        notice.classList.remove('is-error');
        notice.textContent = 'Saving your report preference…';
        try {
          await api.setStudyTermVisibility(checkbox.dataset.termKind, checkbox.dataset.termKey, checkbox.checked);
          notice.textContent = checkbox.checked ? 'This item will appear in your study reports.' : 'This item is hidden from your reports and remains here.';
        } catch (error) {
          checkbox.checked = previous;
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
