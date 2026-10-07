import './styles.css';
import { showBook, showLibrary } from './pages/library.js';

const path = decodeURIComponent(window.location.pathname);
const match = path.match(/^\/book\/([^/]+)\/?$/);
if (match) showBook(match[1]);
else showLibrary();
