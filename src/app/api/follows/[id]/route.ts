import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { invalidateProfile } from '@/lib/server/recs/engine';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  db.prepare('INSERT OR IGNORE INTO followed_artists(user_id, artist_id, created_at) SELECT ?, id, ? FROM artists WHERE id = ?').run(u.id, now(), id);
  invalidateProfile(u.id);
  return { ok: true };
});
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  db.prepare('DELETE FROM followed_artists WHERE user_id = ? AND artist_id = ?').run(u.id, id);
  invalidateProfile(u.id);
  return { ok: true };
});
