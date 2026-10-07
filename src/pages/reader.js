import { api } from '../api.js';
import { escapeHTML, setPage } from '../utils.js';

function shell(content) {
  return `<div class="site-shell">
    <header class="site-header"><a class="wordmark" href="/" aria-label="Tadoku home"><span class="wordmark-mark" lang="ja">桜</span><span>Tadoku<small>READER LIBRARY</small></span></a><nav class="header-nav" aria-label="Main navigation"><a href="/">The library</a></nav></header>
    ${content}<footer class="site-footer"><span>A quiet place to read Japanese.</span><span lang="ja">ゆっくり読んで、楽しく学ぼう。</span></footer>
  </div>`;
}

function statusSelect(book, status) {
  const choices = [['To_Do', 'To do'], ['In_Progress', 'In progress'], ['Finished', 'Finished']];
  return `<label class="reading-status-control"><span class="sr-only">Reading status for ${escapeHTML(book.name)}</span><select id="reader-status">${choices.map(([value, label]) => `<option value="${value}"${status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

export async function showReader(slug, user) {
  setPage('Open reader', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" lang="ja">読</span><p>Opening the PDF…</p></main>'));
  try {
    const [{ book }, progress] = await Promise.all([
      api.book(slug),
      user ? api.progress() : Promise.resolve(null),
    ]);
    const status = progress?.books?.find((entry) => entry.slug === book.slug)?.status || 'To_Do';
    const guideAction = status === 'Finished'
      ? `<a class="button button-secondary" href="/study/${encodeURIComponent(book.slug)}">Open finished study guide <span aria-hidden="true">↗</span></a>`
      : '';
    const finishAction = user && status !== 'Finished'
      ? `<button class="button button-primary" id="finish-reader" type="button">Mark this book finished <span aria-hidden="true">✓</span></button>`
      : '';
    const note = user
      ? `<div class="reader-progress-tools">${statusSelect(book, status)}<span>Progress is saved to your account.</span></div>`
      : `<p class="access-note">The PDF is open to everyone. <span>Sign in from the top of the page to save progress.</span></p>`;
    const content = `<main class="reader-page" data-reading-status="${status}">
      <a class="back-link" href="/book/${encodeURIComponent(book.slug)}">← Reader details</a>
      <header class="reader-heading"><div><span class="eyebrow">${escapeHTML(book.level || 'Japanese reader')}</span><h1>${escapeHTML(book.name)}</h1>${book.japaneseTitle ? `<p class="book-japanese" lang="ja">${escapeHTML(book.japaneseTitle)}</p>` : ''}</div><a class="button button-quiet" href="/pdf/${encodeURIComponent(book.slug)}" target="_blank" rel="noopener noreferrer">Open PDF in a new tab <span aria-hidden="true">↗</span></a></header>
      <div class="pdf-viewer"><iframe src="/pdf/${encodeURIComponent(book.slug)}" title="${escapeHTML(book.name)} Japanese PDF"></iframe></div>
      <section class="finish-reading" aria-labelledby="finish-title"><div><span class="eyebrow">YOUR READING PROGRESS</span><h2 id="finish-title">${status === 'Finished' ? 'You finished this reader.' : 'Reached the last page?'}</h2><p>${status === 'Finished' ? 'Your translated study guide is ready whenever you want to review it.' : 'Mark it finished to unlock the Japanese study guide and its vocabulary and grammar notes.'}</p></div>${note}<div class="finish-actions">${finishAction}${guideAction}</div><p class="reader-feedback" id="reader-feedback" role="status" hidden></p></section>
    </main>`;
    setPage(book.name, shell(content));

    const select = document.querySelector('#reader-status');
    if (select) {
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api.setProgress(book.slug, select.value);
          window.location.reload();
        } catch (error) {
          const feedback = document.querySelector('#reader-feedback');
          feedback.textContent = error.message;
          feedback.hidden = false;
          select.disabled = false;
        }
      });
    }

    const finish = document.querySelector('#finish-reader');
    if (finish) {
      finish.addEventListener('click', async () => {
        finish.disabled = true;
        const feedback = document.querySelector('#reader-feedback');
        try {
          await api.setProgress(book.slug, 'Finished');
          feedback.textContent = 'Finished. Your study guide is now unlocked.';
          feedback.hidden = false;
          window.location.reload();
        } catch (error) {
          feedback.textContent = error.message;
          feedback.hidden = false;
          finish.disabled = false;
        }
      });
    }
  } catch (error) {
    setPage('PDF not found', shell(`<section class="error-state"><span class="eyebrow">Reader unavailable</span><h1>We couldn’t open this PDF.</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="/">Return to the library</a></section>`));
  }
}
