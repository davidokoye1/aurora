import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { dailyMixes, discoverWeekly, onRepeat, forgottenFavorites, moodMix } from '@/lib/server/recs/engine';
import { moodById } from '@/lib/server/recs/lexicon';
import { getSettings } from '@/lib/server/user';
import { queryTracks } from '@/lib/server/catalog';
import { recentTracks } from '@/lib/server/home';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const ex = getSettings(u.id).explicitFilter;
  let mix = null;
  if (id.startsWith('daily-')) mix = dailyMixes(u.id, ex).find((m) => m.id === id) ?? null;
  else if (id === 'discover') mix = discoverWeekly(u.id, ex);
  else if (id === 'onrepeat') mix = onRepeat(u.id);
  else if (id === 'forgotten') mix = forgottenFavorites(u.id);
  else if (id.startsWith('mood-')) {
    const m = moodById(id.slice(5));
    if (m) mix = moodMix(u.id, m, 60, ex);
  } else if (id === 'recent') {
    const tracks = queryTracks(u.id, `WHERE t.kind = 'music' ORDER BY t.added_at DESC LIMIT 100`);
    mix = { id, kind: 'recent' as const, title: 'Recently Added', subtitle: 'The newest arrivals in your library.', color: '#5fc9b4', tracks, covers: [...new Set(tracks.map((t) => t.cover).filter(Boolean))].slice(0, 4) as string[] };
  } else if (id === 'history') {
    const tracks = recentTracks(u.id, 100);
    mix = { id, kind: 'recent' as const, title: 'Recently Played', subtitle: 'Pick up where you left off.', color: '#8b7bff', tracks, covers: [...new Set(tracks.map((t) => t.cover).filter(Boolean))].slice(0, 4) as string[] };
  }
  if (!mix) throw new HttpError(404, 'This mix isn’t available yet — listen to a bit more music and it will appear.');
  return mix;
});
