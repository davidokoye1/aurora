import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { queryTracks } from '@/lib/server/catalog';
import { invalidateProfile } from '@/lib/server/recs/engine';

export const GET = route(async () => {
  const u = await requireUser();
  return queryTracks(u.id, 'JOIN likes l ON l.track_id = t.id AND l.user_id = @uid ORDER BY l.created_at DESC');
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const { trackIds } = await body<{ trackIds: string[] }>(req);
  const ins = db.prepare('INSERT OR IGNORE INTO likes(user_id, track_id, created_at) SELECT ?, id, ? FROM tracks WHERE id = ?');
  db.transaction(() => (trackIds ?? []).slice(0, 1000).forEach((id, i) => ins.run(u.id, now() + i, id)))();
  invalidateProfile(u.id);
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const { trackIds } = await body<{ trackIds: string[] }>(req);
  const del = db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?');
  db.transaction(() => (trackIds ?? []).forEach((id) => del.run(u.id, id)))();
  invalidateProfile(u.id);
  return { ok: true };
});
