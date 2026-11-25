import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { search } from '@/lib/server/search';
import { getSettings } from '@/lib/server/user';

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') ?? '').slice(0, 200);
  const res = search(u.id, q, { limit: Number(sp.get('limit') ?? 40), explicitFilter: getSettings(u.id).explicitFilter });
  if (sp.get('record') === '1' && q.trim().length >= 2) {
    db.prepare('INSERT INTO search_history(user_id, query, created_at) VALUES (?,?,?)').run(u.id, q.trim(), now());
  }
  return res;
});
