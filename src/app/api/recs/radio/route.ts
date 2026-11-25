import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { radio } from '@/lib/server/recs/engine';
import { db } from '@/lib/server/db';
import { getSettings } from '@/lib/server/user';

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const trackId = sp.get('track') ?? undefined;
  const artistId = sp.get('artist') ?? undefined;
  if (!trackId && !artistId) throw new HttpError(400, 'A seed track or artist is required.');
  const exclude = (sp.get('exclude') ?? '').split(',').filter(Boolean);
  const count = Number(sp.get('count') ?? 50);
  const ex = getSettings(u.id).explicitFilter;
  const tracks = radio(u.id, { trackId, artistId }, count, exclude, ex);
  let title = 'Radio';
  if (artistId) title = `${(db.prepare('SELECT name FROM artists WHERE id = ?').get(artistId) as { name: string } | undefined)?.name ?? 'Artist'} Radio`;
  else if (trackId) title = `${(db.prepare('SELECT title FROM tracks WHERE id = ?').get(trackId) as { title: string } | undefined)?.title ?? 'Song'} Radio`;
  return { title, tracks };
});
