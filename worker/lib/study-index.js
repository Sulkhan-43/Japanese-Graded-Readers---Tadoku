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

export async function getBookStudyIndex(env, slug) {
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
         GROUP BY v.vocabulary_key, own.first_passage, own.occurrence_count
         ORDER BY own.occurrence_count DESC, v.japanese ASC`,
        [slug],
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
         GROUP BY g.grammar_key, own.first_passage, own.occurrence_count
         ORDER BY own.occurrence_count DESC, g.pattern ASC`,
        [slug],
      );
    return { vocabulary: vocabulary.rows, grammar: grammar.rows };
  } finally {
    await client.end();
  }
}

export async function renderBookStudyIndex(env, slug) {
  const index = await getBookStudyIndex(env, slug);
  return renderIndexMarkup(index.vocabulary, index.grammar);
}
