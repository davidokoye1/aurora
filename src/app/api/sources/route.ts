import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { createSourceRow, toSourceDTO } from '@/lib/server/sources/manage';
import { startSync, sourceConfig, type SourceRow } from '@/lib/server/sync';
import { refreshWatchers } from '@/lib/server/watch';
import { configSchema } from '@/lib/server/sources/schema';

export const GET = route(async () => {
  await requireUser();
  const rows = db.prepare("SELECT * FROM sources ORDER BY type = 'upload', created_at DESC").all() as SourceRow[];
  return rows.map(toSourceDTO);
});



const createSchema = z.object({
  type: z.enum(['http', 'playlist', 'subsonic', 'jellyfin', 'manifest', 'rss', 'folder']),
  name: z.string().trim().min(1).max(120),
  url: z.string().max(4000).optional(),
  config: configSchema.default({}),
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const input = createSchema.parse(await body(req));
  let url: string | null = null;
  if (input.type === 'folder') {
    if (!u.is_admin) throw new HttpError(403, 'Only the server admin can add server folders.');
    const p = input.config.path?.trim();
    if (!p || !path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new HttpError(400, 'That folder doesn’t exist on this computer.');
    const want = path.resolve(p).toLowerCase();
    for (const r of db.prepare("SELECT * FROM sources WHERE type = 'folder'").all() as SourceRow[]) {
      const have = sourceConfig(r).path;
      if (!have) continue;
      const h = path.resolve(have).toLowerCase();
      if (h === want) throw new HttpError(409, 'This folder is already in your library.');
      if (want.startsWith(h + path.sep)) throw new HttpError(409, `This folder is already included — it’s inside “${r.name}”.`);
    }
    input.config.path = path.resolve(p);
  } else {
    if (!input.url) throw new HttpError(400, 'A URL is required.');
    let raw = input.url.trim();
    if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
    try {
      url = new URL(raw).toString();
    } catch {
      throw new HttpError(400, 'That URL is not valid.');
    }
    const dup = db.prepare('SELECT id FROM sources WHERE url = ? AND type = ?').get(url, input.type) as { id: string } | undefined;
    if (dup) throw new HttpError(409, 'This source has already been added.');
  }
  const id = createSourceRow(u.id, input.type, input.name, url, input.config);
  startSync(id);
  refreshWatchers();
  return toSourceDTO(db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow);
});
