CREATE TABLE IF NOT EXISTS reader_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  avatar_symbol TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(username) BETWEEN 4 AND 48)
);

CREATE TABLE IF NOT EXISTS reader_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES reader_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reader_sessions_user_idx ON reader_sessions (user_id);
CREATE INDEX IF NOT EXISTS reader_sessions_expiry_idx ON reader_sessions (expires_at);

CREATE TABLE IF NOT EXISTS reader_signup_ip_guard (
  ip_hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reader_login_attempts (
  ip_hash TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ip_hash, username_normalized)
);

CREATE TABLE IF NOT EXISTS reader_book_progress (
  user_id UUID NOT NULL REFERENCES reader_users(user_id) ON DELETE CASCADE,
  book_slug TEXT NOT NULL REFERENCES study_books(slug) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('To_Do', 'In_Progress', 'Finished')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, book_slug)
);

CREATE INDEX IF NOT EXISTS reader_book_progress_book_idx ON reader_book_progress (book_slug);
