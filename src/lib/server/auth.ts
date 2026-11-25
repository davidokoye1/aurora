import 'server-only';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { db, now, uid } from './db';
import { hashToken } from './secret';

export const SESSION_COOKIE = 'aurora_session';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 60; // 60 days

export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: number;
  created_at: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function createUser(email: string, name: string, passwordHash: string): User {
  const count = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  const id = uid();
  db.prepare('INSERT INTO users(id,email,name,password_hash,is_admin,created_at) VALUES (?,?,?,?,?,?)').run(
    id, email.trim(), name.trim(), passwordHash, count === 0 ? 1 : 0, now(),
  );
  db.prepare('INSERT INTO user_settings(user_id, json) VALUES (?, ?)').run(id, '{}');
  return db.prepare('SELECT id,email,name,is_admin,created_at FROM users WHERE id = ?').get(id) as User;
}

export async function startSession(userId: string, userAgent?: string | null) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at,user_agent) VALUES (?,?,?,?,?)').run(
    hashToken(token), userId, now() + SESSION_TTL, now(), userAgent?.slice(0, 200) ?? null,
  );
  const jar = await cookies();
  const h = await headers();
  const proto = (h.get('x-forwarded-proto') ?? '').split(',')[0].trim();
  const secure = process.env.COOKIE_SECURE === '1' || (process.env.COOKIE_SECURE !== '0' && proto === 'https');
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id,u.email,u.name,u.is_admin,u.created_at,s.expires_at,s.id sid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(hashToken(token)) as (User & { expires_at: number; sid: string }) | undefined;
  if (!row || row.expires_at < now()) return null;
  // sliding expiry (refresh at most daily)
  if (row.expires_at - now() < SESSION_TTL - 86_400_000) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now() + SESSION_TTL, row.sid);
  }
  const { expires_at: _e, sid: _s, ...user } = row;
  return user;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Not signed in');
  return u;
}
export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.is_admin) throw new HttpError(403, 'Admin only');
  return u;
}

/** Simple fixed-window rate limiter persisted in SQLite. Returns true if allowed. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const row = db.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').get(key) as
    | { count: number; window_start: number }
    | undefined;
  const t = now();
  if (!row || t - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO login_attempts(key,count,window_start) VALUES (?,?,?)').run(key, 1, t);
    return true;
  }
  if (row.count >= max) return false;
  db.prepare('UPDATE login_attempts SET count = count + 1 WHERE key = ?').run(key);
  return true;
}
