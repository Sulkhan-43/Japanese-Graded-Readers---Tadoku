import { Client } from 'pg';

const PASSWORD_ITERATIONS = 310_000;
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;
const AVATAR_SYMBOLS = ['桜', '猫', '月', '波', '竹', '鶴', '富士', '鯉', '本', '鳥', '山', '狐'];
const encoder = new TextEncoder();

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function openDatabase(env) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error('Hyperdrive binding is not configured.');
  return new Client({ connectionString: env.HYPERDRIVE.connectionString });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function hmacIp(request, env) {
  const secret = env.AUTH_PEPPER || env.HYPERDRIVE?.connectionString;
  if (!secret) throw new Error('AUTH_PEPPER is not configured.');
  const ip = request.headers.get('CF-Connecting-IP') || 'local-development';
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return bytesToBase64Url(new Uint8Array(signature));
}

function normalizeUsername(value) {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function validateCredentials(payload) {
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  const key = typeof payload?.key === 'string' ? payload.key : '';
  const passwordHint = typeof payload?.passwordHint === 'string' ? payload.passwordHint.trim() : '';
  const length = [...username].length;
  if (length < 4 || length > 48) throw new AuthError('Username must be between 4 and 48 characters.');
  if ([...key].length < 4 || [...key].length > 256) throw new AuthError('Key must be between 4 and 256 characters.');
  if ([...passwordHint].length > 160) throw new AuthError('Password hint must be 160 characters or fewer.');
  return { username, usernameNormalized: normalizeUsername(username), key, passwordHint };
}

async function derivePassword(key, salt, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(key), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return new Uint8Array(bits);
}

function sameBytes(left, right) {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) mismatch |= (left[index % left.length] || 0) ^ (right[index % right.length] || 0);
  return mismatch === 0;
}

function sessionCookieName(request) {
  return new URL(request.url).protocol === 'https:' ? '__Host-tadoku_session' : 'tadoku_session';
}

function getCookie(request, name) {
  const entry = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
}

function formatCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:';
  const name = sessionCookieName(request);
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function insertSession(client, request, userId) {
  const token = new Uint8Array(32);
  crypto.getRandomValues(token);
  const rawToken = bytesToBase64Url(token);
  await client.query('DELETE FROM reader_sessions WHERE expires_at < NOW()');
  await client.query(
    'INSERT INTO reader_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 days\')',
    [await sha256(rawToken), userId],
  );
  return formatCookie(request, rawToken, SESSION_SECONDS);
}

export async function currentUser(request, env) {
  const token = getCookie(request, sessionCookieName(request));
  if (!token) return null;
  const client = openDatabase(env);
  try {
    await client.connect();
    const result = await client.query(
      `SELECT u.user_id AS id, u.username, u.avatar_symbol AS "avatarSymbol"
       FROM reader_sessions s JOIN reader_users u ON u.user_id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [await sha256(token)],
    );
    return result.rows[0] || null;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function createAccount(request, env, payload) {
  const { username, usernameNormalized, key, passwordHint } = validateCredentials(payload);
  const ipHash = await hmacIp(request, env);
  const client = openDatabase(env);
  await client.connect();
  try {
    const hashed = await client.query("SELECT crypt($1, gen_salt('bf', 12)) AS value", [await sha256(key)]);
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ipHash]);
    await client.query("DELETE FROM reader_signup_ip_guard WHERE created_at < NOW() - INTERVAL '24 hours'");
    const recentSignup = await client.query(
      'SELECT username_prefix FROM reader_signup_ip_guard WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL \'24 hours\'',
      [ipHash],
    );
    if (recentSignup.rowCount) {
      const prefix = recentSignup.rows[0].username_prefix;
      const accountHint = prefix ? ` as “${prefix}**”` : ' from this network';
      throw new AuthError(`You are already registered${accountHint}. Log in or try again after 24 hours.`, 429);
    }

    const inserted = await client.query(
      `INSERT INTO reader_users
         (username, username_normalized, password_salt, password_hash, password_iterations, password_algorithm, avatar_symbol, password_hint)
       VALUES ($1, $2, NULL, $3, NULL, 'bcrypt', $4, $5)
       RETURNING user_id AS id, username, avatar_symbol AS "avatarSymbol"`,
      [username, usernameNormalized, hashed.rows[0].value,
        AVATAR_SYMBOLS[crypto.getRandomValues(new Uint32Array(1))[0] % AVATAR_SYMBOLS.length], passwordHint],
    );
    await client.query(
      `INSERT INTO reader_signup_ip_guard (ip_hash, username_prefix) VALUES ($1, $2)
       ON CONFLICT (ip_hash) DO UPDATE SET created_at = NOW(), username_prefix = EXCLUDED.username_prefix`,
      [ipHash, [...username].slice(0, 4).join('')],
    );
    const cookie = await insertSession(client, request, inserted.rows[0].id);
    await client.query('COMMIT');
    return { user: inserted.rows[0], cookie };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AuthError) throw error;
    if (error?.code === '23505') throw new AuthError('That username is already in use.', 409);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function lookupPasswordHint(request, env, payload) {
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  const usernameLength = [...username].length;
  if (usernameLength < 4 || usernameLength > 48) throw new AuthError('Enter your username to look up its hint.');

  const ipHash = await hmacIp(request, env);
  const client = openDatabase(env);
  await client.connect();
  try {
    await client.query("DELETE FROM reader_password_hint_attempts WHERE window_started_at < NOW() - INTERVAL '1 day'");
    const attempt = await client.query(
      `INSERT INTO reader_password_hint_attempts (ip_hash, attempts, window_started_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (ip_hash) DO UPDATE SET
         attempts = CASE WHEN reader_password_hint_attempts.window_started_at < NOW() - INTERVAL '15 minutes'
                         THEN 1 ELSE reader_password_hint_attempts.attempts + 1 END,
         window_started_at = CASE WHEN reader_password_hint_attempts.window_started_at < NOW() - INTERVAL '15 minutes'
                                  THEN NOW() ELSE reader_password_hint_attempts.window_started_at END
       RETURNING attempts`,
      [ipHash],
    );
    if (attempt.rows[0].attempts > LOGIN_ATTEMPT_LIMIT) {
      throw new AuthError('Too many password-hint requests. Try again in 15 minutes.', 429);
    }

    const result = await client.query(
      'SELECT password_hint AS hint FROM reader_users WHERE username_normalized = $1',
      [normalizeUsername(username)],
    );
    return { hint: result.rows[0]?.hint || null };
  } finally {
    await client.end().catch(() => {});
  }
}

async function recordFailedLogin(client, ipHash, usernameNormalized) {
  await client.query(
    `INSERT INTO reader_login_attempts (ip_hash, username_normalized, attempts, window_started_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (ip_hash, username_normalized) DO UPDATE SET
       attempts = CASE WHEN reader_login_attempts.window_started_at < NOW() - INTERVAL '15 minutes'
                       THEN 1 ELSE reader_login_attempts.attempts + 1 END,
       window_started_at = CASE WHEN reader_login_attempts.window_started_at < NOW() - INTERVAL '15 minutes'
                                THEN NOW() ELSE reader_login_attempts.window_started_at END`,
    [ipHash, usernameNormalized],
  );
}

export async function login(request, env, payload) {
  const { usernameNormalized, key } = validateCredentials(payload);
  const ipHash = await hmacIp(request, env);
  const client = openDatabase(env);
  await client.connect();
  try {
    await client.query("DELETE FROM reader_login_attempts WHERE window_started_at < NOW() - INTERVAL '1 day'");
    const attempts = await client.query(
      'SELECT attempts, window_started_at FROM reader_login_attempts WHERE ip_hash = $1 AND username_normalized = $2',
      [ipHash, usernameNormalized],
    );
    const activeWindow = attempts.rows[0] && Date.now() - new Date(attempts.rows[0].window_started_at).getTime() < LOGIN_WINDOW_MS;
    if (activeWindow && attempts.rows[0].attempts >= LOGIN_ATTEMPT_LIMIT) {
      throw new AuthError('Too many unsuccessful attempts. Try again in 15 minutes.', 429);
    }

    const found = await client.query(
      `SELECT user_id AS id, username, avatar_symbol AS "avatarSymbol", password_salt,
              password_hash, password_iterations, password_algorithm
       FROM reader_users WHERE username_normalized = $1`,
      [usernameNormalized],
    );
    const account = found.rows[0];
    let matches = false;
    if (account?.password_algorithm === 'bcrypt') {
      const check = await client.query(
        account
          ? 'SELECT password_hash = crypt($1, password_hash) AS matches FROM reader_users WHERE user_id = $2'
          : "SELECT crypt($1, gen_salt('bf', 12)) AS ignored",
        account ? [await sha256(key), account.id] : [await sha256(key)],
      );
      matches = Boolean(account && check.rows[0].matches);
    } else if (account) {
      const salt = base64UrlToBytes(account.password_salt);
      const expected = base64UrlToBytes(account.password_hash);
      const actual = await derivePassword(key, salt, account.password_iterations || PASSWORD_ITERATIONS);
      matches = sameBytes(actual, expected);
    } else {
      await client.query("SELECT crypt($1, gen_salt('bf', 12)) AS ignored", [await sha256(key)]);
    }
    if (!account || !matches) {
      await recordFailedLogin(client, ipHash, usernameNormalized);
      throw new AuthError('Username or key is incorrect.', 401);
    }

    await client.query('DELETE FROM reader_login_attempts WHERE ip_hash = $1 AND username_normalized = $2', [ipHash, usernameNormalized]);
    const cookie = await insertSession(client, request, account.id);
    return { user: { id: account.id, username: account.username, avatarSymbol: account.avatarSymbol }, cookie };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function logout(request, env) {
  const token = getCookie(request, sessionCookieName(request));
  if (token) {
    const client = openDatabase(env);
    try {
      await client.connect();
      await client.query('DELETE FROM reader_sessions WHERE token_hash = $1', [await sha256(token)]);
    } finally {
      await client.end().catch(() => {});
    }
  }
  return formatCookie(request, '', 0);
}

export async function readingProgress(env, userId) {
  const client = openDatabase(env);
  try {
    await client.connect();
    const result = await client.query(
      `SELECT b.slug, b.name, b.level, COALESCE(p.status, 'To_Do') AS status, p.updated_at AS "updatedAt"
       FROM study_books b
       LEFT JOIN reader_book_progress p ON p.book_slug = b.slug AND p.user_id = $1
       ORDER BY b.level, b.name`,
      [userId],
    );
    const totals = { total: 0, To_Do: 0, In_Progress: 0, Finished: 0 };
    const levelMap = new Map();
    for (const book of result.rows) {
      totals.total += 1;
      totals[book.status] += 1;
      if (!levelMap.has(book.level)) levelMap.set(book.level, { level: book.level, total: 0, To_Do: 0, In_Progress: 0, Finished: 0 });
      const level = levelMap.get(book.level);
      level.total += 1;
      level[book.status] += 1;
    }
    return { books: result.rows, totals, levels: [...levelMap.values()] };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function updateReadingProgress(env, userId, slug, status) {
  if (!['To_Do', 'In_Progress', 'Finished'].includes(status)) throw new AuthError('Choose To Do, In Progress, or Finished.');
  const client = openDatabase(env);
  try {
    await client.connect();
    const result = await client.query(
      `INSERT INTO reader_book_progress (user_id, book_slug, status)
       SELECT $1, slug, $3 FROM study_books WHERE slug = $2
       ON CONFLICT (user_id, book_slug) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
       RETURNING book_slug AS slug, status, updated_at AS "updatedAt"`,
      [userId, slug, status],
    );
    if (!result.rowCount) throw new AuthError('Reader not found.', 404);
    return result.rows[0];
  } finally {
    await client.end().catch(() => {});
  }
}

export async function bookIsFinished(env, userId, slug) {
  const client = openDatabase(env);
  try {
    await client.connect();
    const result = await client.query(
      "SELECT 1 FROM reader_book_progress WHERE user_id = $1 AND book_slug = $2 AND status = 'Finished'",
      [userId, slug],
    );
    return result.rowCount > 0;
  } finally {
    await client.end().catch(() => {});
  }
}
