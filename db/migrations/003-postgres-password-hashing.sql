CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE reader_users
  ADD COLUMN IF NOT EXISTS password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2';

ALTER TABLE reader_users
  ALTER COLUMN password_salt DROP NOT NULL,
  ALTER COLUMN password_iterations DROP NOT NULL;

ALTER TABLE reader_users
  ADD CONSTRAINT reader_users_password_algorithm_check
  CHECK (password_algorithm IN ('pbkdf2', 'bcrypt'));
