import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';

type Ctx = { params: Promise<{ token: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { token } = await ctx.params;
  const link = db.prepare('SELECT playlist_id, kind FROM share_links WHERE token = ?').get(token) as { playlist_id: string; kind: string } | undefined;
  if (!link) throw new HttpError(404, 'This link is no longer valid.');
  if (link.kind !== 'collab') throw new HttpError(403, 'This link is view-only.');
  db.prepare('INSERT OR IGNORE INTO playlist_collaborators(playlist_id, user_id, added_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM playlists WHERE id = ? AND owner_id = ?)').run(link.playlist_id, u.id, now(), link.playlist_id, u.id);
  return { playlistId: link.playlist_id };
});
