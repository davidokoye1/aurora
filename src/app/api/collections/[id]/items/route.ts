import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';

type Ctx = { params: Promise<{ id: string }> };
const KINDS = ['track', 'album', 'artist', 'playlist'];

async function check(ctx: Ctx) {
  const u = await requireUser();
  const { id } = await ctx.params;
  if (!db.prepare('SELECT 1 FROM collections WHERE id = ? AND owner_id = ?').get(id, u.id)) throw new HttpError(404, 'Collection not found');
  return id;
}

export const POST = route<Ctx>(async (req, ctx) => {
  const id = await check(ctx);
  const { kind, refIds } = await body<{ kind: string; refIds: string[] }>(req);
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Unknown item kind');
  const ins = db.prepare('INSERT OR IGNORE INTO collection_items(collection_id, kind, ref_id, added_at) VALUES (?,?,?,?)');
  db.transaction(() => (refIds ?? []).forEach((r, i) => ins.run(id, kind, r, now() + i)))();
  return { ok: true };
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const id = await check(ctx);
  const { kind, refIds } = await body<{ kind: string; refIds: string[] }>(req);
  const del = db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND kind = ? AND ref_id = ?');
  db.transaction(() => (refIds ?? []).forEach((r) => del.run(id, kind, r)))();
  return { ok: true };
});
