import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { cancelSync, getSourceRow, startSync } from '@/lib/server/sync';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const row = getSourceRow(id);
  if (!row) throw new HttpError(404, 'Source not found');
  if (row.paused) throw new HttpError(409, 'Resume this source before syncing.');
  return startSync(id);
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  cancelSync(id);
  return { ok: true };
});
