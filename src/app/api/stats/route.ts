import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { stats } from '@/lib/server/home';

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const r = (sp.get('range') ?? '4w') as '4w' | '6m' | '1y' | 'all';
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;
  return stats(u.id, ['4w', '6m', '1y', 'all'].includes(r) ? r : '4w', year);
});
