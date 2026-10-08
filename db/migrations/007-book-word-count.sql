ALTER TABLE study_books
  ADD COLUMN IF NOT EXISTS word_count INTEGER NOT NULL DEFAULT 0
  CHECK (word_count >= 0);
