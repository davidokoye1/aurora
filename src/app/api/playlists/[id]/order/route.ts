import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { assertCanEdit } from '@/lib/server/user';

type Ctx = { params: Promise<{ id: string }> };

/** Persist a full new order of entry ids (drag & drop). */
export const PUT = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  assertCanEdit(u.id, id);
  const { entryIds } = await body<{ entryIds: string[] }>(req);
  const upd = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND id = ?');
  db.transaction(() => (entryIds ?? []).forEach((e, i) => upd.run(i + 1, id, e)))();
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), id);
  return { ok: true };
});
