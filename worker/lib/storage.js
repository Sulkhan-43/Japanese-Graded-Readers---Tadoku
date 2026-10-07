const LIBRARY_KEY = 'library.json';

export async function readJSON(bucket, key, fallback = null) {
  const object = await bucket.get(key);
  if (!object) return fallback;
  try {
    return await object.json();
  } catch {
    throw new Error(`Stored JSON is invalid: ${key}`);
  }
}

export async function getLibrary(bucket) {
  return readJSON(bucket, LIBRARY_KEY, { version: 1, updatedAt: new Date().toISOString(), books: [] });
}

export function toLibraryEntry(metadata) {
  return {
    id: metadata.id,
    name: metadata.name,
    japaneseTitle: metadata.japaneseTitle || '',
    slug: metadata.slug,
    level: metadata.level || 'Unleveled',
    originalUrl: metadata.originalUrl || '',
    pdfPath: `/pdf/${metadata.slug}`,
    coverPath: metadata.coverR2Key ? `/assets/books/${metadata.slug}/cover?v=${encodeURIComponent(metadata.updatedAt || '')}` : null,
    status: metadata.generationStatus,
  };
}
