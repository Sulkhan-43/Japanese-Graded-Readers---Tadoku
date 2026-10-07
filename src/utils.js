export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function setPage(title, markup) {
  document.title = `${title} · Tadoku`;
  document.querySelector('#app').innerHTML = markup;
}
