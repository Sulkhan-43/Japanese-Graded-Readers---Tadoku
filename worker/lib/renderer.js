function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderIndex(items, kind) {
  if (!items.length) return '<p class="quiet">No notes for this section.</p>';
  return `<ol class="index-list">${items.map((item) => kind === 'word'
    ? `<li><div class="index-jp">${escapeHTML(item.japanese)}${item.reading ? `<span>${escapeHTML(item.reading)}</span>` : ''}</div><div><strong>${escapeHTML(item.dictionaryForm)}</strong><span class="index-romaji">${escapeHTML(item.romaji || '')}</span></div><p>${escapeHTML(item.meaning)}</p></li>`
    : `<li><div class="index-pattern">${escapeHTML(item.pattern)}</div><p>${escapeHTML(item.explanation)}</p></li>`).join('')}</ol>`;
}

export function renderStudyGuide(data, metadata) {
  const passages = data.passages.map((passage, passageIndex) => `
    <section class="passage" aria-labelledby="passage-${passageIndex + 1}">
      <div class="passage-heading"><span class="eyebrow">${passage.pageNumber ? `PAGE ${passage.pageNumber}` : `PASSAGE ${String(passageIndex + 1).padStart(2, '0')}`}</span><h2 id="passage-${passageIndex + 1}">${escapeHTML(passage.title || `Reading ${passageIndex + 1}`)}</h2></div>
      ${passage.lines.map((line) => `
        <article class="line-card">
          <p class="japanese" lang="ja">${escapeHTML(line.japanese)}</p>
          ${line.reading ? `<p class="reading" lang="ja">${escapeHTML(line.reading)}</p>` : ''}
          <p class="romaji">${escapeHTML(line.romaji)}</p>
          <p class="translation">${escapeHTML(line.translation)}</p>
          ${line.vocabulary.length ? `<details><summary>Vocabulary <span>${line.vocabulary.length}</span></summary><ul>${line.vocabulary.map((word) => `<li><strong>${escapeHTML(word.japanese)}</strong>${word.reading ? ` <span class="reading">${escapeHTML(word.reading)}</span>` : ''}<span> — ${escapeHTML(word.meaning)}</span></li>`).join('')}</ul></details>` : ''}
          ${line.grammar.length ? `<details><summary>Grammar <span>${line.grammar.length}</span></summary><ul>${line.grammar.map((note) => `<li><strong>${escapeHTML(note.pattern)}</strong><span> — ${escapeHTML(note.explanation)}</span></li>`).join('')}</ul></details>` : ''}
        </article>`).join('')}
    </section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light"><title>${escapeHTML(metadata.name)} — Tadoku Study Guide</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#25382f;background:#f5f3ed;font-synthesis:none;text-rendering:optimizeLegibility}
    *{box-sizing:border-box}body{margin:0;line-height:1.65}.shell{max-width:900px;margin:auto;padding:32px 24px 80px}
    a{color:inherit}.topline{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9d8cf;padding:0 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#617267}
    .topline a{text-decoration:none}.hero{padding:55px 0 45px;border-bottom:1px solid #d9d8cf}.eyebrow{font:500 11px ui-monospace,monospace;letter-spacing:.16em;color:#a14f37;text-transform:uppercase}
    h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:400;line-height:1.16}h1{font-size:clamp(38px,7vw,68px);margin:13px 0 10px;letter-spacing:-.045em}.subtitle{font-size:28px;margin:0;color:#596d60}.level{display:inline-block;margin-top:22px;padding:5px 10px;border:1px solid #c6c9bd;border-radius:2px;font-size:12px;color:#596d60}
    .passage{padding:44px 0 0}.passage-heading{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid #d9d8cf;margin-bottom:12px}.passage-heading h2{font-size:28px;margin:7px 0 14px}.passage-heading .eyebrow{white-space:nowrap}
    .line-card{padding:25px 0 23px;border-bottom:1px solid #e0dfd7}.japanese{font-family:"Yu Mincho","Hiragino Mincho ProN",serif;font-size:25px;line-height:1.8;margin:0;color:#18372e}.reading{font-size:14px;color:#7b8176;margin:0}.romaji{font-size:15px;color:#6c5744;margin:9px 0 2px}.translation{font-size:16px;margin:3px 0 14px}
    details{font-size:14px;margin:8px 0;color:#566a5d}summary{cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-weight:600}summary span{font:11px ui-monospace,monospace;color:#a14f37}details ul{padding-left:20px;margin:10px 0 2px;color:#293c32}details li{margin:7px 0}.index{padding:38px 0 4px;border-top:1px solid #d9d8cf;margin-top:38px}.index h2{font-size:30px;margin:0 0 18px}.index-list{padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#deded5;border:1px solid #deded5}.index-list li{background:#faf9f5;padding:15px}.index-jp{font-size:16px;color:#18372e}.index-jp span,.index-romaji{font-size:12px;color:#82877d;margin-left:6px}.index-pattern{font-weight:600;color:#18372e}.index-list p,.quiet{font-size:14px;color:#68766d;margin:5px 0 0}.footer{border-top:1px solid #d9d8cf;margin-top:48px;padding-top:16px;color:#778077;font-size:12px}
    @media(max-width:560px){.shell{padding:20px 18px 56px}.hero{padding:40px 0 32px}.passage-heading{display:block}.passage-heading h2{margin-top:4px}.index-list{grid-template-columns:1fr}.japanese{font-size:22px}}
  </style>
</head>
<body><main class="shell">
  <nav class="topline" aria-label="Breadcrumb"><a href="/">Tadoku · Reader Library</a><a href="${escapeHTML(metadata.originalUrl)}" target="_blank" rel="noopener noreferrer">Original book ↗</a></nav>
  <header class="hero"><span class="eyebrow">Japanese study guide</span><h1>${escapeHTML(data.book.title)}</h1>${data.book.japaneseTitle ? `<p class="subtitle" lang="ja">${escapeHTML(data.book.japaneseTitle)}</p>` : ''}<span class="level">Level ${escapeHTML(data.book.level)}</span></header>
  ${passages}
  <section class="index" aria-labelledby="vocabulary-index"><span class="eyebrow">Reference</span><h2 id="vocabulary-index">Vocabulary index</h2>${renderIndex(data.vocabularyIndex, 'word')}</section>
  <section class="index" aria-labelledby="grammar-index"><span class="eyebrow">Reference</span><h2 id="grammar-index">Grammar index</h2>${renderIndex(data.grammarIndex, 'grammar')}</section>
  <footer class="footer">Study material generated for personal language learning. Check the original reader for source context.</footer>
</main></body></html>`;
}
