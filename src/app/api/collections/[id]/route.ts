import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { queryAlbums, queryArtists, tracksByIds } from '@/lib/server/catalog';
import { getPlaylist } from '@/lib/server/user';

type Ctx = { params: Promise<{ id: string }> };

function own(userId: string, id: string) {
  const c = db.prepare('SELECT * FROM collections WHERE id = ? AND owner_id = ?').get(id, userId) as { id: string; name: string; color: string | null } | undefined;
  if (!c) throw new HttpError(404, 'Collection not found');
  return c;
}

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const c = own(u.id, id);
  const items = db.prepare('SELECT kind, ref_id FROM collection_items WHERE collection_id = ? ORDER BY added_at DESC').all(id) as { kind: string; ref_id: string }[];
  const ids = (k: string) => items.filter((i) => i.kind === k).map((i) => i.ref_id);
  const inList = (k: string, p: string) => `IN (${ids(k).map((_, i) => '@' + p + i).join(',') || "''"})`;
  const params = (k: string, p: string) => Object.fromEntries(ids(k).map((x, i) => [p + i, x]));
  const playlists = ids('playlist').flatMap((pid) => {
    try {
      return [getPlaylist(u.id, pid)];
    } catch {
      return [];
    }
  });
  return {
    collection: c,
    tracks: tracksByIds(u.id, ids('track')),
    albums: queryAlbums(u.id, `WHERE a.id ${inList('album', 'a')}`, params('album', 'a')),
    artists: queryArtists(u.id, `WHERE ar.id ${inList('artist', 'r')}`, params('artist', 'r')),
    playlists,
  };
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  own(u.id, id);
  const { name, color } = await body<{ name?: string; color?: string }>(req);
  if (name?.trim()) db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name.trim().slice(0, 80), id);
  if (color !== undefined) db.prepare('UPDATE collections SET color = ? WHERE id = ?').run(color, id);
  return { ok: true };
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  own(u.id, id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return { ok: true };
});
