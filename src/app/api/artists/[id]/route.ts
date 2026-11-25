import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { queryAlbums, queryArtists, queryTracks, tracksByIds } from '@/lib/server/catalog';
import { index } from '@/lib/server/recs/engine';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const artist = queryArtists(u.id, 'WHERE ar.id = @id', { id })[0];
  if (!artist) throw new HttpError(404, 'Artist not found');
  // Popular = most played by anyone on this server, then by your likes, then album order
  const popularIds = (db
    .prepare(`SELECT t.id FROM tracks t LEFT JOIN play_events e ON e.track_id = t.id AND e.skipped = 0
      WHERE t.artist_id = ? GROUP BY t.id ORDER BY count(e.id) DESC, EXISTS(SELECT 1 FROM likes l WHERE l.track_id = t.id) DESC, t.year DESC, t.track_no LIMIT 10`)
    .all(id) as { id: string }[]).map((r) => r.id);
  const popular = tracksByIds(u.id, popularIds);
  const albums = queryAlbums(u.id, 'WHERE a.artist_id = @id ORDER BY a.year DESC, a.title', { id });
  const appearsOn = queryAlbums(u.id, 'WHERE a.artist_id != @id AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.artist_id = @id) LIMIT 12', { id });
  const all = queryTracks(u.id, 'WHERE t.artist_id = @id ORDER BY t.album_title, COALESCE(t.disc_no,1), t.track_no', { id });
  // Related artists: share genre families / tags
  const idx = index();
  const myFams = new Map<string, number>();
  for (const f of idx.feats) if (f.artistId === id) for (const fam of f.fams) myFams.set(fam, (myFams.get(fam) ?? 0) + 1);
  const tags: string[] = artist.tags;
  const score = new Map<string, number>();
  for (const f of idx.feats) {
    if (!f.artistId || f.artistId === id) continue;
    let s = 0;
    for (const fam of f.fams) s += myFams.get(fam) ?? 0;
    if (s) score.set(f.artistId, (score.get(f.artistId) ?? 0) + s);
  }
  if (tags.length) {
    for (const r of db.prepare('SELECT id, tags FROM artists WHERE tags IS NOT NULL AND id != ?').all(id) as { id: string; tags: string }[]) {
      const t: string[] = JSON.parse(r.tags);
      const shared = t.filter((x) => tags.includes(x)).length;
      if (shared) score.set(r.id, (score.get(r.id) ?? 0) + shared * 20);
    }
  }
  const relIds = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x]) => x);
  const relMap = new Map(queryArtists(u.id, `WHERE ar.id IN (${relIds.map((_, i) => '@r' + i).join(',') || "''"})`, Object.fromEntries(relIds.map((x, i) => ['r' + i, x]))).map((a) => [a.id, a]));
  const related = relIds.map((x) => relMap.get(x)).filter(Boolean);
  return { artist, popular, albums, appearsOn, related, all };
});
