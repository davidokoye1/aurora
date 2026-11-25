import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { autoplay } from '@/lib/server/recs/engine';
import { getSettings } from '@/lib/server/user';

/** Smart autoplay from your library. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const { recent, count } = await body<{ recent: string[]; count?: number }>(req);
  const want = Math.min(50, count ?? 15);
  const ex = getSettings(u.id).explicitFilter;
  const seen = (recent ?? []).slice(-200);
  return autoplay(u.id, seen, want, ex);
});
