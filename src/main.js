import './styles.css';
import { api } from './api.js';
import { mountAuth } from './auth-ui.js';
import { showBook, showLibrary } from './pages/library.js';
import { showProfile } from './pages/profile.js';
import { showReader } from './pages/reader.js';
import { showHiddenStudyTerms, showStudyTerms } from './pages/study-terms.js';

async function start() {
  const user = (await api.session().catch(() => ({ user: null }))).user;
  const path = decodeURIComponent(window.location.pathname);
  const bookMatch = path.match(/^\/book\/([^/]+)\/?$/);
  const readerMatch = path.match(/^\/read\/([^/]+)\/?$/);
  const hiddenTermsMatch = path.match(/^\/(vocabulary|grammar)\/hidden\/?$/);

  if (path === '/profile' || path === '/profile/') await showProfile(user);
  else if (hiddenTermsMatch) await showHiddenStudyTerms(user, hiddenTermsMatch[1]);
  else if (path === '/vocabulary' || path === '/vocabulary/') await showStudyTerms(user);
  else if (readerMatch) await showReader(readerMatch[1], user);
  else if (bookMatch) await showBook(bookMatch[1], user);
  else await showLibrary(user);

  mountAuth(user);
}

start();
