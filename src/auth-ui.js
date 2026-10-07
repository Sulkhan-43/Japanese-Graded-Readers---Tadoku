import { api } from './api.js';
import { escapeHTML } from './utils.js';

function dialogMarkup() {
  return `<dialog class="auth-dialog" id="auth-dialog" aria-labelledby="auth-title">
    <button class="dialog-close" type="button" aria-label="Close sign in window" data-auth-close>×</button>
    <span class="eyebrow">YOUR READING SHELF</span><h2 id="auth-title">Keep your place.</h2>
    <p class="auth-intro">A simple username and key save your reading status and finished guides.</p>
    <div class="auth-tabs" role="tablist" aria-label="Account access">
      <button type="button" role="tab" aria-selected="true" data-auth-mode="login">Log in</button>
      <button type="button" role="tab" aria-selected="false" data-auth-mode="signup">Sign up</button>
    </div>
    <form id="auth-form">
      <label for="auth-username">Username</label><input id="auth-username" name="username" autocomplete="username" minlength="4" maxlength="48" required>
      <label for="auth-key">Key</label><input id="auth-key" name="key" type="password" autocomplete="current-password" minlength="4" maxlength="256" required>
      <p class="auth-error" id="auth-error" role="alert" hidden></p>
      <button class="button button-primary auth-submit" type="submit">Log in</button>
    </form>
    <p class="auth-footnote">No email needed. Usernames and keys can be as short as four characters.</p>
  </dialog>`;
}

export function mountAuth(user) {
  const nav = document.querySelector('.header-nav');
  if (!nav) return;

  if (user) {
    nav.innerHTML = `<a href="/">The library</a><a class="profile-nav" href="/profile"><span class="profile-avatar" lang="ja">${escapeHTML(user.avatarSymbol || '桜')}</span><span>My progress</span></a><button class="header-auth-button" type="button" data-sign-out>Sign out</button>`;
    nav.querySelector('[data-sign-out]').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api.logout();
        window.location.assign('/');
      } catch (error) {
        window.alert(error.message);
        event.currentTarget.disabled = false;
      }
    });
    return;
  }

  nav.innerHTML = `<a class="is-active" href="/">The library</a><button class="header-auth-button" type="button" data-auth-open>Log in / Sign up</button>`;
  document.body.insertAdjacentHTML('beforeend', dialogMarkup());
  const dialog = document.querySelector('#auth-dialog');
  const form = dialog.querySelector('#auth-form');
  const submit = form.querySelector('[type="submit"]');
  const errorBox = dialog.querySelector('#auth-error');
  let mode = 'login';

  const chooseMode = (nextMode) => {
    mode = nextMode;
    for (const tab of dialog.querySelectorAll('[data-auth-mode]')) tab.setAttribute('aria-selected', String(tab.dataset.authMode === mode));
    submit.textContent = mode === 'login' ? 'Log in' : 'Create account';
    dialog.querySelector('#auth-key').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    errorBox.hidden = true;
    errorBox.textContent = '';
  };

  nav.querySelector('[data-auth-open]').addEventListener('click', () => {
    chooseMode('login');
    dialog.showModal();
    dialog.querySelector('#auth-username').focus();
  });
  for (const tab of dialog.querySelectorAll('[data-auth-mode]')) tab.addEventListener('click', () => chooseMode(tab.dataset.authMode));
  dialog.querySelector('[data-auth-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    errorBox.hidden = true;
    const username = form.elements.username.value;
    const key = form.elements.key.value;
    try {
      if (mode === 'signup') await api.signup(username, key);
      else await api.login(username, key);
      window.location.reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.disabled = false;
    }
  });
}
