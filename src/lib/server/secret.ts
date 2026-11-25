import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db';

function loadSecret(): Buffer {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest();
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}
const KEY = loadSecret();

/** AES-256-GCM encrypt arbitrary JSON (used for source credentials). */
export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function unseal<T>(sealed: string | null | undefined): T | null {
  if (!sealed) return null;
  try {
    const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}
export function hashToken(t: string) {
  return crypto.createHmac('sha256', KEY).update(t).digest('base64url');
}
