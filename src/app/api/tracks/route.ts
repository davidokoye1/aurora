import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { tracksByIds } from '@/lib/server/catalog';

export const GET = route(async (req) => {
  const u = await requireUser();
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 1000);
  return tracksByIds(u.id, ids);
});
