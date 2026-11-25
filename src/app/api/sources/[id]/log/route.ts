import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { syncProgress } from '@/lib/server/sync';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const live = syncProgress(id);
  if (live && live.status === 'running') return { log: live.log, job: live };
  const job = db.prepare('SELECT * FROM sync_jobs WHERE source_id = ? ORDER BY started_at DESC LIMIT 1').get(id) as { log: string } | undefined;
  return { log: job?.log ? job.log.split('\n') : live?.log ?? [], job: job ?? null };
});
