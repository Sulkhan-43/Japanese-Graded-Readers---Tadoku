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
    ? `<span class="study-term-detail study-term-reading"><small>${item.romaji ? 'Romaji' : 'Reading'}</small><span>${escapeHTML(item.romaji || item.reading || '')}</span></span><span class="study-term-detail study-term-meaning"><small>English</small><span>${escapeHTML(item.meaning || '')}</span></span>`
    : `<span>${escapeHTML(item.explanation || '')}</span>`;
  return `<article class="study-term-card">
    <div class="study-term-copy"><h3 lang="ja">${title}</h3><div class="study-term-description">${subtitle}</div></div>
    <div class="study-term-count"><strong>${Number(item.occurrences) || 0}</strong><span>encounters</span><small>across ${Number(item.finishedBookCount) || 0} finished ${item.finishedBookCount === 1 ? 'book' : 'books'}</small></div>
    <label class="study-term-toggle"><input type="checkbox" data-term-kind="${kind}" data-term-key="${escapeHTML(item.key)}" ${item.showInReport ? 'checked' : ''}><span>Show in my reports</span></label>
  </article>`;
}

function termPanel(items, kind, label, emptyMessage) {
  const visible = items.filter((item) => item.showInReport);
  const hidden = items.filter((item) => !item.showInReport);
  return `<section id="${kind}-panel" role="tabpanel" aria-labelledby="${kind}-tab" class="study-term-panel" ${kind === 'grammar' ? 'hidden' : ''}>
    <div class="study-term-list" data-visible-terms="${kind}">${visible.length ? visible.map((item) => termMarkup(item, kind)).join('') : `<p class="study-term-empty">${emptyMessage}</p>`}</div>
    <details class="study-hidden-group" data-hidden-group="${kind}" ${hidden.length ? '' : 'hidden'}>
      <summary>Hidden ${label.toLowerCase()} <span data-hidden-count="${kind}">${hidden.length}</span></summary>
      <div class="study-term-list study-hidden-list" data-hidden-terms="${kind}">${hidden.map((item) => termMarkup(item, kind)).join('')}</div>
    </details>
  </section>`;
}

function pageMarkup(data) {
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
    ${termPanel(vocab, 'vocabulary', 'Vocabulary', 'Finish a book to collect vocabulary here.')}
    ${termPanel(grammar, 'grammar', 'Grammar', 'Grammar notes from finished books will appear here.')}
    <p class="study-terms-notice" id="study-terms-notice" role="status" aria-live="polite">Hidden items stay here and can be revealed from the bottom of each list. Story Japanese is always kept intact.</p>
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
          const kind = checkbox.dataset.termKind;
          const panel = document.querySelector(`#${kind}-panel`);
          const card = checkbox.closest('.study-term-card');
          const source = card.parentElement;
          const hiddenGroup = panel.querySelector(`[data-hidden-group="${kind}"]`);
          const target = checkbox.checked
            ? panel.querySelector(`[data-visible-terms="${kind}"]`)
            : panel.querySelector(`[data-hidden-terms="${kind}"]`);
          source.querySelector('.study-term-empty')?.remove();
          target.querySelector('.study-term-empty')?.remove();
          target.append(card);
          const hiddenCount = panel.querySelectorAll(`[data-hidden-terms="${kind}"] .study-term-card`).length;
          const visibleCount = panel.querySelectorAll(`[data-visible-terms="${kind}"] .study-term-card`).length;
          hiddenGroup.hidden = hiddenCount === 0;
          panel.querySelector(`[data-hidden-count="${kind}"]`).textContent = hiddenCount;
          if (!visibleCount) {
            const empty = document.createElement('p');
            empty.className = 'study-term-empty';
            empty.textContent = `All ${kind} items are hidden. Open the hidden ${kind} section below to reveal them.`;
            panel.querySelector(`[data-visible-terms="${kind}"]`).append(empty);
          }
          const vocabVisible = document.querySelectorAll('[data-visible-terms="vocabulary"] .study-term-card').length;
          const grammarVisible = document.querySelectorAll('[data-visible-terms="grammar"] .study-term-card').length;
          const vocabHidden = document.querySelectorAll('[data-hidden-terms="vocabulary"] .study-term-card').length;
          const grammarHidden = document.querySelectorAll('[data-hidden-terms="grammar"] .study-term-card').length;
          document.querySelector('[data-visible-count="vocabulary"]').textContent = vocabVisible;
          document.querySelector('[data-hidden-tab-count="vocabulary"]').textContent = `(Hidden ${vocabHidden})`;
          document.querySelector('[data-visible-count="grammar"]').textContent = grammarVisible;
          document.querySelector('[data-hidden-tab-count="grammar"]').textContent = `(Hidden ${grammarHidden})`;
          document.querySelector('[data-visible-total]').textContent = vocabVisible + grammarVisible;
          document.querySelector('.study-terms-hidden-count').textContent = `(Hidden ${vocabHidden + grammarHidden})`;
          if (!checkbox.checked && hiddenCount === 1) hiddenGroup.open = false;
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
