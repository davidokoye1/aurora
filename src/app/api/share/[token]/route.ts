import { route } from '@/lib/server/api';
import { currentUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { tracksByIds } from '@/lib/server/catalog';
import { getPlaylist } from '@/lib/server/user';

type Ctx = { params: Promise<{ token: string }> };

/** Public: a shared playlist's contents (metadata only — streaming requires an account on this server). */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { token } = await ctx.params;
  const link = db.prepare('SELECT playlist_id, kind FROM share_links WHERE token = ?').get(token) as { playlist_id: string; kind: string } | undefined;
  if (!link) throw new HttpError(404, 'This link is no longer valid.');
  const u = await currentUser();
  const viewer = u?.id ?? '';
  const playlist = getPlaylist(viewer, link.playlist_id, { allowPublic: true });
  const ids = (db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(link.playlist_id) as { track_id: string }[]).map((r) => r.track_id);
  const tracks = tracksByIds(viewer, ids);
  return { playlist: { ...playlist, canEdit: false }, tracks, kind: link.kind, signedIn: !!u, isMember: !!u && (playlist.isOwner || playlist.canEdit) };
});
