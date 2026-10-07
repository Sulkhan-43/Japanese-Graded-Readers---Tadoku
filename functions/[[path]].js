import { handleRequest } from '../worker/index.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/study/') || url.pathname.startsWith('/assets/books/')) {
    return handleRequest(request, env);
  }
  return next();
}
