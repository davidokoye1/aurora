import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db, now, ART_DIR } from '@/lib/server/db';
import { assertCanEdit, getPlaylist } from '@/lib/server/user';
import { tracksByIds } from '@/lib/server/catalog';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const playlist = getPlaylist(u.id, id);
  const entries = db
    .prepare(`SELECT pt.id entry_id, pt.track_id, pt.added_at, u.name added_by FROM playlist_tracks pt LEFT JOIN users u ON u.id = pt.added_by WHERE pt.playlist_id = ? ORDER BY pt.position`)
    .all(id) as { entry_id: string; track_id: string; added_at: number; added_by: string | null }[];
  const tracks = tracksByIds(u.id, [...new Set(entries.map((e) => e.track_id))]);
  const map = new Map(tracks.map((t) => [t.id, t]));
  const collaborators = db.prepare('SELECT u.id, u.name FROM playlist_collaborators c JOIN users u ON u.id = c.user_id WHERE c.playlist_id = ?').all(id);
  return {
    playlist,
    collaborators,
    entries: entries.filter((e) => map.has(e.track_id)).map((e) => ({ entryId: e.entry_id, addedAt: e.added_at, addedBy: e.added_by, track: map.get(e.track_id)! })),
  };
});

const patch = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(1000).optional(), collaborative: z.boolean().optional(), cover: z.null().optional() });

export const PATCH = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const pl = assertCanEdit(u.id, id);
  const input = patch.parse(await body(req));
  if (input.collaborative != null && !pl.isOwner) throw new HttpError(403, 'Only the owner can change collaboration.');
  if (input.name != null) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(input.name, id);
  if (input.description != null) db.prepare('UPDATE playlists SET description = ? WHERE id = ?').run(input.description, id);
  if (input.collaborative != null) db.prepare('UPDATE playlists SET collaborative = ? WHERE id = ?').run(input.collaborative ? 1 : 0, id);
  if (input.cover === null) {
    const cur = db.prepare('SELECT cover FROM playlists WHERE id = ?').get(id) as { cover: string | null };
    if (cur.cover?.startsWith('/api/art/')) {
      const f = path.join(ART_DIR, cur.cover.slice(9));
      const used = db.prepare('SELECT 1 FROM albums WHERE cover = ? UNION SELECT 1 FROM tracks WHERE cover = ? LIMIT 1').get(cur.cover, cur.cover);
      if (!used && fs.existsSync(f)) fs.unlinkSync(f);
    }
    db.prepare('UPDATE playlists SET cover = NULL WHERE id = ?').run(id);
  }
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), id);
  return getPlaylist(u.id, id);
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const pl = getPlaylist(u.id, id);
  if (pl.isOwner) db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  else db.prepare('DELETE FROM playlist_collaborators WHERE playlist_id = ? AND user_id = ?').run(id, u.id);
  return { ok: true, left: !pl.isOwner };
});
