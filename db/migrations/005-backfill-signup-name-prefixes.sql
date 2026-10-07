UPDATE reader_signup_ip_guard AS guard
SET username_prefix = LEFT(users.username, 4)
FROM reader_users AS users
WHERE guard.username_prefix IS NULL
  AND guard.created_at = users.created_at;
