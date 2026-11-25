import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { suggest } from '@/lib/server/search';

export const GET = route(async (req) => {
  const u = await requireUser();
  return suggest(u.id, (new URL(req.url).searchParams.get('q') ?? '').slice(0, 200));
});
