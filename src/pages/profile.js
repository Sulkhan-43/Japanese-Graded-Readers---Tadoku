import { api } from '../api.js';
import { escapeHTML, setPage } from '../utils.js';

function shell(content) {
  return `<div class="site-shell">
    <header class="site-header"><a class="wordmark" href="/" aria-label="Tadoku home"><img class="wordmark-mark" src="/brand-mark.svg" alt=""><span>Tadoku<small>READER LIBRARY</small></span></a><nav class="header-nav" aria-label="Main navigation"><a href="/">The library</a></nav></header>
    ${content}<footer class="site-footer"><span>A quiet place to read Japanese.</span><span lang="ja">г‚†гЃЈгЃЏг‚ЉиЄ­г‚“гЃ§гЂЃжҐЅгЃ—гЃЏе­¦гЃјгЃ†гЂ‚</span></footer>
  </div>`;
}

function statusSelect(book) {
  const status = book.status || 'To_Do';
  const choices = [['To_Do', 'To do'], ['In_Progress', 'In progress'], ['Finished', 'Finished']];
  return `<label class="reading-status-control"><span class="sr-only">Reading status for ${escapeHTML(book.name)}</span><select data-book-status="${escapeHTML(book.slug)}">${choices.map(([value, label]) => `<option value="${value}"${status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function profileMarkup(user, progress) {
  const totals = progress.totals;
  const levels = progress.levels.length
    ? progress.levels.map((level) => {
      const finishedPercent = level.total ? Math.round((level.Finished / level.total) * 100) : 0;
      return `<article class="level-progress"><div class="level-progress-heading"><h3>${escapeHTML(level.level)}</h3><span>${level.Finished} of ${level.total} finished</span></div><div class="progress-track" role="img" aria-label="${finishedPercent}% of ${escapeHTML(level.level)} readers finished"><span style="width:${finishedPercent}%"></span></div><div class="level-counts"><span><b>${level.To_Do}</b> To do</span><span><b>${level.In_Progress}</b> In progress</span><span><b>${level.Finished}</b> Finished</span></div></article>`;
    }).join('')
    : '<p class="empty-progress">There are no readers on the shelf yet.</p>';
  const books = progress.books.length
    ? `<div class="progress-book-list">${progress.books.map((book) => `<article class="progress-book-row"><a href="/read/${encodeURIComponent(book.slug)}"><span class="eyebrow">${escapeHTML(book.level)}</span><strong>${escapeHTML(book.name)}</strong></a>${statusSelect(book)}${book.status === 'Finished' ? `<a class="study-shortcut" href="/study/${encodeURIComponent(book.slug)}">Study guide в†—</a>` : ''}</article>`).join('')}</div>`
    : '';

  return `<main class="profile-page">
    <section class="profile-welcome"><div class="large-profile-avatar" aria-hidden="true" lang="ja">${escapeHTML(user.avatarSymbol || 'жЎњ')}</div><div><span class="eyebrow">YOUR READING SHELF</span><h1>Hello, ${escapeHTML(user.username)}.</h1><p>Every page you finish adds to your Tadoku reading journey.</p></div></section>
    <section class="reading-stats" aria-label="Reading totals">
      <article class="reading-stat"><span>BOOKS READ</span><strong>${totals.Finished}</strong><small>finished</small></article>
      <article class="reading-stat"><span>IN PROGRESS</span><strong>${totals.In_Progress}</strong><small>currently reading</small></article>
      <article class="reading-stat"><span>LEFT TO READ</span><strong>${totals.To_Do}</strong><small>waiting on your shelf</small></article>
      <article class="reading-stat reading-stat-total"><span>LIBRARY</span><strong>${totals.total}</strong><small>${totals.total === 1 ? 'reader' : 'readers'} total</small></article>
    </section>
    <section class="profile-section" aria-labelledby="level-progress-title"><div class="profile-section-heading"><div><span class="eyebrow">YOUR COLLECTION</span><h2 id="level-progress-title">Progress by level</h2></div><p>Finished readers unlock their full study guides.</p></div><div class="level-progress-grid">${levels}</div></section>
    <section class="profile-section" aria-labelledby="your-books-title"><div class="profile-section-heading"><div><span class="eyebrow">YOUR BOOKS</span><h2 id="your-books-title">Reading status</h2></div><p>Update a bookвЂ™s status here or from its shelf card.</p></div>${books}</section>
  </main>`;
}

export async function showProfile(user) {
  if (!user) {
    setPage('My progress', shell(`<main class="profile-locked"><span class="eyebrow">YOUR READING SHELF</span><h1>Sign in to see your progress.</h1><p>Your finished books and reading status are saved to your account.</p><a class="button button-primary" href="/">Back to the library</a></main>`));
    return;
  }

  setPage('My progress', shell('<main class="loading-state" aria-busy="true"><span class="loading-mark" lang="ja">иЄ­</span><p>Gathering your reading progressвЂ¦</p></main>'));
  try {
    const progress = await api.progress();
    setPage('My progress', shell(profileMarkup(user, progress)));
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
  } catch (error) {
    setPage('My progress', shell(`<section class="error-state"><span class="eyebrow">Progress unavailable</span><h1>We couldnвЂ™t open your reading shelf.</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="/profile">Try again</a></section>`));
  }
}
