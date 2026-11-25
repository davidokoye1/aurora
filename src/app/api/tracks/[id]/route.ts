import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { tracksByIds, cleanupOrphans } from '@/lib/server/catalog';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const t = tracksByIds(u.id, [id])[0];
  if (!t) throw new HttpError(404, 'Track not found');
  const copies = db
    .prepare('SELECT c.id, c.format, c.bitrate, c.size, c.playable, c.failures, s.name source, s.type source_type FROM track_copies c JOIN sources s ON s.id = c.source_id WHERE c.track_id = ?')
    .all(id);
  const plays = db.prepare('SELECT count(*) c, max(created_at) last FROM play_events WHERE user_id = ? AND track_id = ? AND skipped = 0').get(u.id, id);
  return { track: t, copies, plays };
});

/** Players report the real duration once metadata loads (remote files often lack it). */
export const PATCH = route<Ctx>(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const { duration } = await body<{ duration?: number }>(req);
  if (duration && duration > 0 && duration < 86400) db.prepare('UPDATE tracks SET duration = ? WHERE id = ? AND (duration IS NULL OR abs(duration - ?) > 3)').run(duration, id, duration);
  return { ok: true };
});

/** Remove an uploaded track (admins can remove any track's upload copy). */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  if (!u.is_admin) throw new HttpError(403, 'Only the admin can delete tracks from the library.');
  db.prepare("DELETE FROM track_copies WHERE track_id = ? AND source_id IN (SELECT id FROM sources WHERE type = 'upload')").run(id);
  const left = db.prepare('SELECT count(*) c FROM track_copies WHERE track_id = ?').get(id) as { c: number };
  if (!left.c) {
    db.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(id);
    db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    cleanupOrphans([]);
  }
  return { ok: true, removed: !left.c };
});
