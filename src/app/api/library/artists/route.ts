import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { queryArtists } from '@/lib/server/catalog';

export const GET = route(async (req) => {
  const u = await requireUser();
  const followed = new URL(req.url).searchParams.get('followed') === '1';
  const where = followed
    ? 'WHERE EXISTS(SELECT 1 FROM followed_artists f WHERE f.user_id = @uid AND f.artist_id = ar.id)'
    : `WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = ar.id AND t.kind = 'music')`;
  return queryArtists(u.id, `${where} ORDER BY ar.name COLLATE NOCASE LIMIT 10000`);
});
