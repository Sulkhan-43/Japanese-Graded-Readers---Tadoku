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
      <div class="auth-hint-signup" id="auth-hint-signup" hidden>
        <label for="auth-password-hint">Password hint <span>(optional)</span></label>
        <input id="auth-password-hint" name="passwordHint" maxlength="160" autocomplete="off" placeholder="A clue only you will recognize">
        <p class="auth-hint-note">Anyone who knows your username can view this hint. Never enter your key or a clue that would reveal it.</p>
      </div>
      <label class="auth-hint-toggle" id="auth-hint-toggle" for="auth-show-hint" hidden><input id="auth-show-hint" type="checkbox"> Show my password hint</label>
      <p class="auth-hint-result" id="auth-hint-result" role="status" aria-live="polite" hidden></p>
      <div class="auth-error" id="auth-error" role="alert" hidden></div>
      <button class="button button-primary auth-submit" type="submit">Log in</button>
    </form>
    <p class="auth-footnote">No email needed. Usernames and keys can be as short as four characters.</p>
  </dialog>`;
}

export function mountAuth(user) {
  const nav = document.querySelector('.header-nav');
  if (!nav) return;

  if (user) {
    nav.innerHTML = `<a href="/">The library</a><a href="/vocabulary">Vocabulary</a><a class="profile-nav" href="/profile"><span class="profile-avatar" lang="ja">${escapeHTML(user.avatarSymbol || '桜')}</span><span>My progress</span></a><button class="header-auth-button" type="button" data-sign-out>Sign out</button>`;
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
  const usernameInput = dialog.querySelector('#auth-username');
  const hintInput = dialog.querySelector('#auth-password-hint');
  const hintToggle = dialog.querySelector('#auth-show-hint');
  const hintResult = dialog.querySelector('#auth-hint-result');
  let hintLookupId = 0;
  let mode = 'login';

  const clearHintResult = () => {
    hintLookupId += 1;
    hintResult.hidden = true;
    hintResult.textContent = '';
  };

  const showRegisteredAccount = (hint, lookupFailed = false) => {
    errorBox.replaceChildren();
    errorBox.classList.add('auth-error--registered');
    const title = document.createElement('strong');
    title.textContent = 'This username already has an account.';
    const detail = document.createElement('span');
    detail.textContent = lookupFailed
      ? 'Could not load the password hint. Try logging in.'
      : hint ? `Password hint: ${hint}` : 'No password hint is saved for this account.';
    const loginButton = document.createElement('button');
    loginButton.className = 'auth-hint-login';
    loginButton.type = 'button';
    loginButton.textContent = 'Log in';
    loginButton.addEventListener('click', () => dialog.querySelector('[data-auth-mode="login"]').click());
    errorBox.append(title, detail, loginButton);
    errorBox.hidden = false;
  };

  const chooseMode = (nextMode) => {
    mode = nextMode;
    for (const tab of dialog.querySelectorAll('[data-auth-mode]')) tab.setAttribute('aria-selected', String(tab.dataset.authMode === mode));
    submit.textContent = mode === 'login' ? 'Log in' : 'Create account';
    dialog.querySelector('#auth-key').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    dialog.querySelector('#auth-hint-signup').hidden = mode !== 'signup';
    dialog.querySelector('#auth-hint-toggle').hidden = mode !== 'login';
    hintToggle.checked = false;
    hintInput.value = '';
    clearHintResult();
    errorBox.classList.remove('auth-error--registered');
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
  usernameInput.addEventListener('input', () => {
    if (hintToggle.checked) hintToggle.checked = false;
    clearHintResult();
  });
  hintToggle.addEventListener('change', async () => {
    clearHintResult();
    if (!hintToggle.checked) return;
    const username = usernameInput.value.trim();
    if ([...username].length < 4) {
      hintToggle.checked = false;
      hintResult.textContent = 'Enter your username first, then check this box.';
      hintResult.hidden = false;
      return;
    }

    const lookupId = hintLookupId;
    hintResult.textContent = 'Looking up your hint…';
    hintResult.hidden = false;
    hintToggle.disabled = true;
    try {
      const { hint } = await api.passwordHint(username);
      if (lookupId !== hintLookupId || !hintToggle.checked) return;
      hintResult.textContent = hint ? `Your password hint: ${hint}` : 'No hint is available for this username.';
    } catch (error) {
      if (lookupId === hintLookupId) hintResult.textContent = error.message;
    } finally {
      hintToggle.disabled = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    errorBox.hidden = true;
    errorBox.classList.remove('auth-error--registered');
    const username = form.elements.username.value;
    const key = form.elements.key.value;
    try {
      if (mode === 'signup') await api.signup(username, key, hintInput.value);
      else await api.login(username, key);
      window.location.reload();
    } catch (error) {
      if (mode === 'signup' && error.status === 409) {
        try {
          const { hint } = await api.passwordHint(username);
          if (mode === 'signup' && usernameInput.value.trim() === username) showRegisteredAccount(hint);
        } catch {
          if (mode === 'signup' && usernameInput.value.trim() === username) showRegisteredAccount(null, true);
        }
      } else {
        errorBox.replaceChildren();
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }
      submit.disabled = false;
    }
  });
}
