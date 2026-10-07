async function readJSON(response) {
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export const api = {
  books: async () => readJSON(await fetch('/api/books')),
  book: async (slug) => readJSON(await fetch(`/api/books/${encodeURIComponent(slug)}`)),
  session: async () => readJSON(await fetch('/api/auth/session', { cache: 'no-store' })),
  progress: async () => readJSON(await fetch('/api/progress', { cache: 'no-store' })),
  setProgress: async (slug, status) => readJSON(await fetch(`/api/progress/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })),
  login: async (username, key) => readJSON(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, key }),
  })),
  signup: async (username, key) => readJSON(await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, key }),
  })),
  logout: async () => readJSON(await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })),
};
