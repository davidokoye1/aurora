import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { moodMix } from '@/lib/server/recs/engine';
import { moodById } from '@/lib/server/recs/lexicon';
import { getSettings } from '@/lib/server/user';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const m = moodById(id);
  if (!m) throw new HttpError(404, 'Mood not found');
  return { ...moodMix(u.id, m, 60, getSettings(u.id).explicitFilter), gradient: m.gradient };
});
