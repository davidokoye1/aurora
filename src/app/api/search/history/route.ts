import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';

export const GET = route(async () => {
  const u = await requireUser();
  return db.prepare('SELECT query, max(created_at) at FROM search_history WHERE user_id = ? GROUP BY lower(query) ORDER BY at DESC LIMIT 12').all(u.id);
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const { query } = await body<{ query: string }>(req);
  if (query?.trim()) db.prepare('INSERT INTO search_history(user_id, query, created_at) VALUES (?,?,?)').run(u.id, query.trim().slice(0, 200), now());
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const q = new URL(req.url).searchParams.get('q');
  if (q) db.prepare('DELETE FROM search_history WHERE user_id = ? AND lower(query) = lower(?)').run(u.id, q);
  else db.prepare('DELETE FROM search_history WHERE user_id = ?').run(u.id);
  return { ok: true };
});
