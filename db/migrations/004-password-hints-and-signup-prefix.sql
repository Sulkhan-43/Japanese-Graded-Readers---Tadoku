ALTER TABLE reader_users
  ADD COLUMN IF NOT EXISTS password_hint TEXT NOT NULL DEFAULT '';

ALTER TABLE reader_signup_ip_guard
  ADD COLUMN IF NOT EXISTS username_prefix TEXT;

CREATE TABLE IF NOT EXISTS reader_password_hint_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
