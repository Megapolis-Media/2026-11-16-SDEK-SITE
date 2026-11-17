import { env } from 'cloudflare:workers';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const cookieName = '__Host-cdek-studio';
const sessionSeconds = 12 * 60 * 60;
const windowMs = 15 * 60 * 1000;
const attemptLimit = 12;

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function tokenHash() {
  const token = (await cookies()).get(cookieName)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? hash(token) : null;
}

function sessionCookie(token: string, maxAge: number) {
  return `${cookieName}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export async function hasStudioSession() {
  const db = env.DB;
  const verifier = env.CDEK_ADMIN_PASSWORD_HASH;
  if (!db || !verifier) return false;
  const token = await tokenHash();
  if (!token) return false;
  return !!await db.prepare(`
    SELECT 1 FROM studio_session WHERE token_hash = ? AND password_version = ? AND expires_at > ?
  `).bind(token, hash(verifier), Date.now()).first();
}

export async function startStudioSession(request: Request, username: string, password: string) {
  const db = env.DB;
  const verifier = env.CDEK_ADMIN_PASSWORD_HASH ?? '';
  const encoded = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(verifier);
  if (!db || !encoded) return { error: 'unavailable' } as const;

  const now = Date.now();
  const client = hash('cdek-studio:login:' + (request.headers.get('cf-connecting-ip') || 'unknown'));
  const [, attempt] = await db.batch([
    db.prepare('DELETE FROM studio_login_attempt WHERE expires_at <= ?').bind(now),
    db.prepare(`
      INSERT INTO studio_login_attempt (client_key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(client_key) DO UPDATE SET attempts = attempts + 1
      WHERE attempts < ?
      RETURNING attempts
    `).bind(client, now + windowMs, attemptLimit),
  ]);
  if (!attempt.results.length) return { error: 'limited' } as const;

  const salt = Buffer.from(encoded[1], 'hex');
  const digest = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
  const passwordMatches = timingSafeEqual(digest, Buffer.from(encoded[2], 'hex'));
  if (username.trim().toLowerCase() !== 'megapolis' || !passwordMatches) return { error: 'credentials' } as const;

  const token = randomBytes(32).toString('base64url');
  const previous = await tokenHash();
  await db.batch([
    db.prepare('DELETE FROM studio_session WHERE expires_at <= ? OR token_hash = ?').bind(now, previous),
    db.prepare('DELETE FROM studio_login_attempt WHERE client_key = ?').bind(client),
    db.prepare('INSERT INTO studio_session (token_hash, password_version, expires_at) VALUES (?, ?, ?)')
      .bind(hash(token), hash(verifier), now + sessionSeconds * 1000),
  ]);
  return { cookie: sessionCookie(token, sessionSeconds) } as const;
}

export async function endStudioSession() {
  const token = await tokenHash();
  if (token && env.DB) await env.DB.prepare('DELETE FROM studio_session WHERE token_hash = ?').bind(token).run();
  return sessionCookie('', 0);
}
