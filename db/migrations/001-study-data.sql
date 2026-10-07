CREATE TABLE IF NOT EXISTS study_books (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  metadata JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_vocabulary (
  vocabulary_key TEXT PRIMARY KEY,
  japanese TEXT NOT NULL,
  reading TEXT NOT NULL DEFAULT '',
  romaji TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  japanese_segments JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS study_book_vocabulary (
  book_slug TEXT NOT NULL REFERENCES study_books(slug) ON DELETE CASCADE,
  vocabulary_key TEXT NOT NULL REFERENCES study_vocabulary(vocabulary_key) ON DELETE CASCADE,
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count >= 0),
  first_passage JSONB NOT NULL DEFAULT 'null'::jsonb,
  PRIMARY KEY (book_slug, vocabulary_key)
);

CREATE TABLE IF NOT EXISTS study_grammar (
  grammar_key TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  pattern_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS study_book_grammar (
  book_slug TEXT NOT NULL REFERENCES study_books(slug) ON DELETE CASCADE,
  grammar_key TEXT NOT NULL REFERENCES study_grammar(grammar_key) ON DELETE CASCADE,
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count >= 0),
  first_passage JSONB NOT NULL DEFAULT 'null'::jsonb,
  PRIMARY KEY (book_slug, grammar_key)
);

CREATE INDEX IF NOT EXISTS study_book_vocabulary_key_idx
  ON study_book_vocabulary (vocabulary_key);
CREATE INDEX IF NOT EXISTS study_book_grammar_key_idx
  ON study_book_grammar (grammar_key);
