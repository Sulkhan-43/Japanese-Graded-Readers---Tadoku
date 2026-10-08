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
  const source = String(html || '');
  const openings = /<(div|p)\b[^>]*\bclass=["']([^"']*)["'][^>]*>/gi;
  let count = 0;
  for (const match of source.matchAll(openings)) {
    const [, tagName, classNames] = match;
    if (!classNames.split(/\s+/).some((name) => name === 'jp' || name === 'japanese')) continue;
    const closeAt = source.indexOf(`</${tagName}>`, match.index + match[0].length);
    if (closeAt < 0) continue;
    const markup = source.slice(match.index + match[0].length, closeAt);
    const japaneseText = decodeHtmlEntities(markup
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
      .replace(/<[^>]*>/g, ''));
    count += countJapaneseWords(japaneseText);
  }
  return count;
}
