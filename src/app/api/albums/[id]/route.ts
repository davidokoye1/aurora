import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { queryAlbums, queryTracks } from '@/lib/server/catalog';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const album = queryAlbums(u.id, 'WHERE a.id = @id', { id })[0];
  if (!album) throw new HttpError(404, 'Album not found');
  const tracks = queryTracks(u.id, 'WHERE t.album_id = @id ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 999), t.title', { id });
  const more = album.artistId ? queryAlbums(u.id, 'WHERE a.artist_id = @aid AND a.id != @id ORDER BY a.year DESC LIMIT 12', { aid: album.artistId, id }) : [];
  return { album, tracks, more };
});
