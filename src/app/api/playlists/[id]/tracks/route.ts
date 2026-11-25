import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { addTracks, assertCanEdit } from '@/lib/server/user';
import { invalidateProfile } from '@/lib/server/recs/engine';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  assertCanEdit(u.id, id);
  const { trackIds, position, skipDuplicates } = await body<{ trackIds: string[]; position?: number; skipDuplicates?: boolean }>(req);
  let ids = (trackIds ?? []).slice(0, 5000);
  let skipped = 0;
  if (skipDuplicates) {
    const existing = new Set((db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?').all(id) as { track_id: string }[]).map((r) => r.track_id));
    const before = ids.length;
    ids = ids.filter((t) => !existing.has(t));
    skipped = before - ids.length;
  }
  const added = addTracks(u.id, id, ids, position);
  invalidateProfile(u.id);
  return { added, skipped };
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  assertCanEdit(u.id, id);
  const { entryIds } = await body<{ entryIds: string[] }>(req);
  const del = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND id = ?');
  db.transaction(() => (entryIds ?? []).forEach((e) => del.run(id, e)))();
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), id);
  invalidateProfile(u.id);
  return { ok: true };
});
