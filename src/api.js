async function readJSON(response) {
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export const api = {
  books: async () => readJSON(await fetch('/api/books')),
  book: async (slug) => readJSON(await fetch(`/api/books/${encodeURIComponent(slug)}`)),
};
