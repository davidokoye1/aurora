import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { queryAlbums } from '@/lib/server/catalog';

const LIB_ALBUM = `EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.kind = 'music')`;

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const saved = sp.get('saved') === '1';
  const sort = sp.get('sort') === 'title' ? 'a.title COLLATE NOCASE' : sp.get('sort') === 'artist' ? 'ar.name COLLATE NOCASE, a.year' : sp.get('sort') === 'year' ? 'a.year DESC' : 'a.created_at DESC';
  const where = saved ? 'WHERE EXISTS(SELECT 1 FROM saved_albums s WHERE s.user_id = @uid AND s.album_id = a.id)' : `WHERE ${LIB_ALBUM}`;
  return queryAlbums(u.id, `${where} ORDER BY ${saved ? '(SELECT created_at FROM saved_albums s WHERE s.user_id = @uid AND s.album_id = a.id) DESC' : sort} LIMIT 10000`);
});
