import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { familyTracks } from '@/lib/server/recs/engine';
import { familyById, FAMILIES } from '@/lib/server/recs/lexicon';
import { queryAlbums, queryArtists } from '@/lib/server/catalog';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  if (!FAMILIES.some((f) => f.id === id)) throw new HttpError(404, 'Genre not found');
  const fam = familyById(id);
  const tracks = familyTracks(u.id, id, 300);
  const albumIds = [...new Set(tracks.map((t) => t.albumId).filter(Boolean))].slice(0, 24) as string[];
  const artistIds = [...new Set(tracks.map((t) => t.artistId).filter(Boolean))].slice(0, 24) as string[];
  const albums = queryAlbums(u.id, `WHERE a.id IN (${albumIds.map((_, i) => '@a' + i).join(',') || "''"})`, Object.fromEntries(albumIds.map((x, i) => ['a' + i, x])));
  const artists = queryArtists(u.id, `WHERE ar.id IN (${artistIds.map((_, i) => '@b' + i).join(',') || "''"})`, Object.fromEntries(artistIds.map((x, i) => ['b' + i, x])));
  return { genre: { id: fam.id, label: fam.label, color: fam.color }, tracks, albums, artists };
});
