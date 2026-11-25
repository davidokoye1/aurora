import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { toSourceDTO, updateSourceConfig } from '@/lib/server/sources/manage';
import { cancelSync, getSourceRow, startSync } from '@/lib/server/sync';
import { refreshWatchers } from '@/lib/server/watch';
import { cleanupOrphans } from '@/lib/server/catalog';
import { configSchema } from '@/lib/server/sources/schema';

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  const u = await requireUser();
  const { id } = await ctx.params;
  const row = getSourceRow(id);
  if (!row) throw new HttpError(404, 'Source not found');
  if (row.owner_id && row.owner_id !== u.id && !u.is_admin) throw new HttpError(403, 'Only the owner or an admin can change this source.');
  return { u, row };
}

export const GET = route<Ctx>(async (_req, ctx) => toSourceDTO((await load(ctx)).row));

const patchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), paused: z.boolean().optional(), config: configSchema.partial().optional(), resync: z.boolean().optional() });

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { row } = await load(ctx);
  const input = patchSchema.parse(await body(req));
  if (input.name) db.prepare('UPDATE sources SET name = ? WHERE id = ?').run(input.name, row.id);
  if (input.paused != null) db.prepare('UPDATE sources SET paused = ? WHERE id = ?').run(input.paused ? 1 : 0, row.id);
  if (input.config) updateSourceConfig(row, input.config);
  if (input.resync) startSync(row.id);
  refreshWatchers();
  return toSourceDTO(getSourceRow(row.id)!);
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { row } = await load(ctx);
  if (row.type === 'upload') throw new HttpError(400, 'The uploads library can’t be removed; delete individual tracks instead.');
  cancelSync(row.id);
  const ids = (db.prepare('SELECT DISTINCT track_id FROM track_copies WHERE source_id = ?').all(row.id) as { track_id: string }[]).map((r) => r.track_id);
  db.prepare('DELETE FROM sources WHERE id = ?').run(row.id);
  db.prepare("DELETE FROM playlists WHERE origin LIKE ? AND NOT EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.playlist_id = playlists.id AND pt.added_by IS NOT NULL AND pt.added_by != playlists.owner_id)").run(`source:${row.id}:%`);
  const removed = cleanupOrphans(ids);
  refreshWatchers();
  return { ok: true, removed };
});
