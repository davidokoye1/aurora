import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { queryTracks } from '@/lib/server/catalog';

const SORTS: Record<string, string> = {
  added: 't.added_at DESC',
  title: 't.title COLLATE NOCASE',
  artist: 't.artist_name COLLATE NOCASE, t.album_title, t.disc_no, t.track_no',
  album: 't.album_title COLLATE NOCASE, t.disc_no, t.track_no',
  duration: 't.duration DESC',
  year: 't.year DESC',
};

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const sort = SORTS[sp.get('sort') ?? 'added'] ?? SORTS.added;
  const limit = Math.min(500, Number(sp.get('limit') ?? 100));
  const offset = Math.max(0, Number(sp.get('offset') ?? 0));
  const kind = sp.get('kind') === 'podcast' ? 'podcast' : sp.get('kind') === 'all' ? null : 'music';
  const source = sp.get('source');
  const where: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (kind) {
    where.push('t.kind = @kind');
    params.kind = kind;
  }
  const q = (sp.get('q') ?? '').trim();
  if (q) {
    where.push("(t.title LIKE @q ESCAPE '\\' OR t.artist_name LIKE @q ESCAPE '\\' OR t.album_title LIKE @q ESCAPE '\\')");
    params.q = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  }
  if (source) {
    where.push('EXISTS (SELECT 1 FROM track_copies c WHERE c.track_id = t.id AND c.source_id = @source)');
    params.source = source;
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (db.prepare(`SELECT count(*) c FROM tracks t ${w}`).get(params) as { c: number }).c;
  const tracks = queryTracks(u.id, `${w} ORDER BY ${sort} LIMIT @limit OFFSET @offset`, params);
  return { total, tracks };
});
