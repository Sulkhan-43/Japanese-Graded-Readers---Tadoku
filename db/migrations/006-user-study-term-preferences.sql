CREATE TABLE IF NOT EXISTS reader_hidden_study_terms (
  user_id UUID NOT NULL REFERENCES reader_users(user_id) ON DELETE CASCADE,
  term_kind TEXT NOT NULL CHECK (term_kind IN ('vocabulary', 'grammar')),
  term_key TEXT NOT NULL,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, term_kind, term_key)
);
