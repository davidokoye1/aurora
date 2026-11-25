import 'server-only';
import { db } from './db';

export interface ServerSettings {
  allowSignup: boolean;
}

const KEY = 'server:settings';
export function getServerSettings(): ServerSettings {
  const row = db.prepare('SELECT value FROM kv_cache WHERE key = ?').get(KEY) as { value: string } | undefined;
  const s = row ? (JSON.parse(row.value) as Partial<ServerSettings>) : {};
  return { allowSignup: process.env.ALLOW_SIGNUP === '1' || !!s.allowSignup };
}
export function saveServerSettings(p: Partial<ServerSettings>) {
  const row = db.prepare('SELECT value FROM kv_cache WHERE key = ?').get(KEY) as { value: string } | undefined;
  const next = { ...(row ? JSON.parse(row.value) : {}), ...p };
  db.prepare('INSERT OR REPLACE INTO kv_cache(key, value, expires_at) VALUES (?,?,?)').run(KEY, JSON.stringify(next), 8_000_000_000_000);
  return getServerSettings();
}
