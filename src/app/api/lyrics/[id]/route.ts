import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { getLyrics } from '@/lib/server/lyrics';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return getLyrics(id, new URL(req.url).searchParams.get('refresh') === '1');
});
