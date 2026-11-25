import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { moodMix } from '@/lib/server/recs/engine';
import { MOODS } from '@/lib/server/recs/lexicon';
import { getSettings } from '@/lib/server/user';

export const GET = route(async () => {
  const u = await requireUser();
  const ex = getSettings(u.id).explicitFilter;
  return MOODS.map((m) => {
    const mix = moodMix(u.id, m, 10, ex);
    return { id: m.id, label: m.label, blurb: m.blurb, gradient: m.gradient, covers: mix.covers, available: mix.tracks.length };
  });
});
