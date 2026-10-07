import { Client } from 'pg';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderJapanese(segments = []) {
  const text = segments.map((segment) => {
    if (segment.base !== undefined) {
      const base = escapeHtml(segment.base);
      const reading = segment.reading ? `<rt>${escapeHtml(segment.reading)}</rt>` : '';
      return `<ruby>${base}${reading}</ruby>`;
    }
    return escapeHtml(segment.text || '');
  }).join('');
  return `<span class="note-loupe-trigger" tabindex="0">${text}<span class="jp-loupe note-loupe" aria-hidden="true"><div class="loupe-kicker">Reading loupe · magnified</div><div class="jp jp-loupe-text note-loupe-text">${text}</div></span></span>`;
}

function normalizeStudyLabel(value = '') {
  return String(value).normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('en-US');
}

function noteLabel(listItem) {
  const strong = listItem.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1];
  if (!strong) return '';
  const popupIndex = strong.search(/<span\b[^>]*class=["'][^"']*\bjp-loupe\b[^"']*["'][^>]*>/i);
  const visible = (popupIndex >= 0 ? strong.slice(0, popupIndex) : strong)
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
  const romajiMatch = visible.match(/\(([^()]*)\)\s*$/);
  return {
    japanese: (romajiMatch ? visible.slice(0, romajiMatch.index) : visible).trim(),
    romaji: romajiMatch?.[1]?.trim() || '',
  };
}

function noteMatchesHiddenTerm(listItem, kind, hiddenTerms) {
  const label = noteLabel(listItem);
  if (!label.japanese) return false;
  return hiddenTerms.some((term) => {
    const expected = kind === 'vocabulary' ? term.japanese : term.pattern;
    if (normalizeStudyLabel(expected) !== normalizeStudyLabel(label.japanese)) return false;
    return kind !== 'vocabulary' || !term.romaji || !label.romaji
      || normalizeStudyLabel(term.romaji) === normalizeStudyLabel(label.romaji);
  });
}

function filterHiddenNotes(html, vocabulary, grammar) {
  if (!vocabulary.length && !grammar.length) return html;
  const sectionPattern = /(<div class="notes">\s*<span class="section-label">([^<]+)<\/span>\s*<ul>)([\s\S]*?)(<\/ul>\s*<\/div>)/gi;
  const filtered = html.replace(sectionPattern, (section, opening, label, items, closing) => {
    const kind = /vocabulary/i.test(label) ? 'vocabulary' : /grammar/i.test(label) ? 'grammar' : '';
    const hiddenTerms = kind === 'vocabulary' ? vocabulary : kind === 'grammar' ? grammar : [];
    if (!hiddenTerms.length) return section;
    let removed = 0;
    const visibleItems = items.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (listItem) => {
      if (!noteMatchesHiddenTerm(listItem, kind, hiddenTerms)) return listItem;
      removed += 1;
      return '';
    });
    if (!removed) return section;
    if (!visibleItems.replace(/<[^>]*>/g, '').trim()) return '';
    return `${opening}${visibleItems}${closing}`;
  });
  return filtered.replace(/<div class="study-notes">\s*<\/div>/gi, '');
}

function renderIndexMarkup(vocabulary, grammar) {
  const vocabRows = vocabulary.map((record) => (
    `<tr><td class="index-japanese">${renderJapanese(record.japaneseSegments)}</td>` +
    `<td>${escapeHtml(record.romaji)}</td><td>${escapeHtml(record.meaning)}</td>` +
    `<td>${escapeHtml(record.firstPassage)}</td><td>${escapeHtml(record.totalOccurrences)}</td></tr>`
  )).join('\n');

  const grammarRows = grammar.map((record) => (
    `<tr><td class="index-japanese">${renderJapanese(record.patternSegments)}</td>` +
    `<td>${escapeHtml(record.explanation)}</td><td>${escapeHtml(record.firstPassage)}</td>` +
    `<td>${escapeHtml(record.totalOccurrences)}</td></tr>`
  )).join('\n');

  return `<section class="master-index" aria-label="Master vocabulary and grammar indexes">
      <section class="index-card" aria-labelledby="vocabulary-index-title">
        <div class="index-card-head"><h2 id="vocabulary-index-title">Master vocabulary index</h2><p>Unique vocabulary introduced in this reader. Rows are ordered by this reader's frequency; the count shows all readers.</p></div>
        <div class="index-table-wrap"><table class="master-table"><thead><tr><th scope="col">Japanese</th><th scope="col">Romaji</th><th scope="col">Meaning</th><th scope="col">First passage</th><th scope="col">Total occurrences</th></tr></thead><tbody>
${vocabRows}
        </tbody></table></div>
      </section>
      <section class="index-card" aria-labelledby="grammar-index-title">
        <div class="index-card-head"><h2 id="grammar-index-title">Master grammar index</h2><p>Rows are ordered by this reader's frequency; the count shows all readers. Repeated uses in one sentence count separately.</p></div>
        <div class="index-table-wrap"><table class="master-table grammar-table"><thead><tr><th scope="col">Pattern</th><th scope="col">Meaning / use</th><th scope="col">First passage</th><th scope="col">Total occurrences</th></tr></thead><tbody>
${grammarRows}
        </tbody></table></div>
      </section>
    </section>`;
}

export async function getBookStudyIndex(env, slug, userId) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error('Hyperdrive binding is not configured.');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    const vocabulary = await client.query(
        `SELECT v.vocabulary_key AS key, v.japanese, v.japanese_segments AS "japaneseSegments",
                v.romaji, v.meaning, own.first_passage AS "firstPassage",
                own.occurrence_count AS "currentOccurrences",
                SUM(bv.occurrence_count)::integer AS "totalOccurrences",
                jsonb_agg(jsonb_build_object(
                  'slug', b.slug, 'name', b.name, 'level', b.level,
                  'occurrences', bv.occurrence_count
                ) ORDER BY b.level, b.name) AS books
         FROM study_vocabulary v
         JOIN study_book_vocabulary own
           ON own.vocabulary_key = v.vocabulary_key AND own.book_slug = $1
         JOIN study_book_vocabulary bv ON bv.vocabulary_key = v.vocabulary_key
         JOIN study_books b ON b.slug = bv.book_slug
         WHERE NOT EXISTS (
           SELECT 1 FROM reader_hidden_study_terms hidden
           WHERE hidden.user_id = $2 AND hidden.term_kind = 'vocabulary'
             AND hidden.term_key = v.vocabulary_key
         )
         GROUP BY v.vocabulary_key, own.first_passage, own.occurrence_count
         ORDER BY own.occurrence_count DESC, v.japanese ASC`,
        [slug, userId],
      );
    const grammar = await client.query(
        `SELECT g.grammar_key AS key, g.pattern, g.pattern_segments AS "patternSegments",
                g.explanation, own.first_passage AS "firstPassage",
                own.occurrence_count AS "currentOccurrences",
                SUM(bg.occurrence_count)::integer AS "totalOccurrences",
                jsonb_agg(jsonb_build_object(
                  'slug', b.slug, 'name', b.name, 'level', b.level,
                  'occurrences', bg.occurrence_count
                ) ORDER BY b.level, b.name) AS books
         FROM study_grammar g
         JOIN study_book_grammar own
           ON own.grammar_key = g.grammar_key AND own.book_slug = $1
         JOIN study_book_grammar bg ON bg.grammar_key = g.grammar_key
         JOIN study_books b ON b.slug = bg.book_slug
         WHERE NOT EXISTS (
           SELECT 1 FROM reader_hidden_study_terms hidden
           WHERE hidden.user_id = $2 AND hidden.term_kind = 'grammar'
             AND hidden.term_key = g.grammar_key
         )
         GROUP BY g.grammar_key, own.first_passage, own.occurrence_count
         ORDER BY own.occurrence_count DESC, g.pattern ASC`,
        [slug, userId],
      );
    return { vocabulary: vocabulary.rows, grammar: grammar.rows };
  } finally {
    await client.end();
  }
}

export async function renderBookStudyIndex(env, slug, userId) {
  const index = await getBookStudyIndex(env, slug, userId);
  return renderIndexMarkup(index.vocabulary, index.grammar);
}

export async function filterUserHiddenStudyNotes(env, slug, userId, html) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error('Hyperdrive binding is not configured.');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT 'vocabulary'::text AS kind, v.japanese, v.romaji, ''::text AS pattern
       FROM reader_hidden_study_terms hidden
       JOIN study_vocabulary v ON v.vocabulary_key = hidden.term_key
       JOIN study_book_vocabulary book_term
         ON book_term.vocabulary_key = v.vocabulary_key AND book_term.book_slug = $2
       WHERE hidden.user_id = $1 AND hidden.term_kind = 'vocabulary'
       UNION ALL
       SELECT 'grammar'::text AS kind, ''::text AS japanese, ''::text AS romaji, g.pattern
       FROM reader_hidden_study_terms hidden
       JOIN study_grammar g ON g.grammar_key = hidden.term_key
       JOIN study_book_grammar book_term
         ON book_term.grammar_key = g.grammar_key AND book_term.book_slug = $2
       WHERE hidden.user_id = $1 AND hidden.term_kind = 'grammar'`,
      [userId, slug],
    );
    return filterHiddenNotes(
      html,
      result.rows.filter((term) => term.kind === 'vocabulary'),
      result.rows.filter((term) => term.kind === 'grammar'),
    );
  } finally {
    await client.end();
  }
}

export async function getFinishedStudyTerms(env, userId) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error('Hyperdrive binding is not configured.');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    const vocabulary = await client.query(
      `SELECT v.vocabulary_key AS key, v.japanese, v.japanese_segments AS "japaneseSegments",
              v.reading, v.romaji, v.meaning,
              SUM(book_term.occurrence_count)::integer AS occurrences,
              COUNT(DISTINCT book_term.book_slug)::integer AS "finishedBookCount",
              hidden.term_key IS NULL AS "showInReport"
       FROM study_vocabulary v
       JOIN study_book_vocabulary book_term ON book_term.vocabulary_key = v.vocabulary_key
       JOIN reader_book_progress progress
         ON progress.book_slug = book_term.book_slug AND progress.user_id = $1 AND progress.status = 'Finished'
       LEFT JOIN reader_hidden_study_terms hidden
         ON hidden.user_id = $1 AND hidden.term_kind = 'vocabulary' AND hidden.term_key = v.vocabulary_key
       GROUP BY v.vocabulary_key, hidden.term_key
       ORDER BY SUM(book_term.occurrence_count) DESC, v.japanese ASC`,
      [userId],
    );
    const grammar = await client.query(
      `SELECT g.grammar_key AS key, g.pattern, g.pattern_segments AS "patternSegments", g.explanation,
              SUM(book_term.occurrence_count)::integer AS occurrences,
              COUNT(DISTINCT book_term.book_slug)::integer AS "finishedBookCount",
              hidden.term_key IS NULL AS "showInReport"
       FROM study_grammar g
       JOIN study_book_grammar book_term ON book_term.grammar_key = g.grammar_key
       JOIN reader_book_progress progress
         ON progress.book_slug = book_term.book_slug AND progress.user_id = $1 AND progress.status = 'Finished'
       LEFT JOIN reader_hidden_study_terms hidden
         ON hidden.user_id = $1 AND hidden.term_kind = 'grammar' AND hidden.term_key = g.grammar_key
       GROUP BY g.grammar_key, hidden.term_key
       ORDER BY SUM(book_term.occurrence_count) DESC, g.pattern ASC`,
      [userId],
    );
    return { vocabulary: vocabulary.rows, grammar: grammar.rows };
  } finally {
    await client.end();
  }
}

export async function setStudyTermVisibility(env, userId, kind, key, showInReport) {
  if (!['vocabulary', 'grammar'].includes(kind)) throw new Error('Choose a vocabulary or grammar item.');
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw new Error('Study term key is invalid.');
  if (typeof showInReport !== 'boolean') throw new Error('Choose whether this item appears in reports.');
  if (!env.HYPERDRIVE?.connectionString) throw new Error('Hyperdrive binding is not configured.');

  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    const itemTable = kind === 'vocabulary' ? 'study_book_vocabulary' : 'study_book_grammar';
    const itemColumn = kind === 'vocabulary' ? 'vocabulary_key' : 'grammar_key';
    const available = await client.query(
      `SELECT 1 FROM ${itemTable} item
       JOIN reader_book_progress progress ON progress.book_slug = item.book_slug
       WHERE progress.user_id = $1 AND progress.status = 'Finished' AND item.${itemColumn} = $2
       LIMIT 1`,
      [userId, key],
    );
    if (!available.rowCount) throw new Error('This item is not part of a finished book on your shelf.');

    if (showInReport) {
      await client.query(
        'DELETE FROM reader_hidden_study_terms WHERE user_id = $1 AND term_kind = $2 AND term_key = $3',
        [userId, kind, key],
      );
    } else {
      await client.query(
        `INSERT INTO reader_hidden_study_terms (user_id, term_kind, term_key)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, term_kind, term_key) DO NOTHING`,
        [userId, kind, key],
      );
    }
    return { kind, key, showInReport };
  } finally {
    await client.end();
  }
}
