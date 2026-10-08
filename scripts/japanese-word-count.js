const japaneseWordSegmenter = new Intl.Segmenter('ja', { granularity: 'word' });

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function countJapaneseWords(text) {
  let count = 0;
  for (const segment of japaneseWordSegmenter.segment(String(text || ''))) {
    if (segment.isWordLike) count += 1;
  }
  return count;
}

export function countJapaneseWordsInReport(html) {
  const passages = String(html || '').matchAll(/<p\b[^>]*\bclass=["']([^"']*)["'][^>]*>([\s\S]*?)<\/p>/gi);
  let count = 0;
  for (const [, classNames, markup] of passages) {
    if (!classNames.split(/\s+/).includes('japanese')) continue;
    const japaneseText = decodeHtmlEntities(markup
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
      .replace(/<[^>]*>/g, ''));
    count += countJapaneseWords(japaneseText);
  }
  return count;
}
