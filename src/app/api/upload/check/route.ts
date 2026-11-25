import fs from 'node:fs';
import path from 'node:path';
import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { UPLOAD_DIR, db } from '@/lib/server/db';
import { uploadSourceId } from '@/lib/server/sources/manage';
import { uploadKey } from '@/lib/server/upload-key';

/**
 * Before uploading, the phone asks which files Aurora already has, so re-uploading a folder only sends what's new.
 * Matches on content hash (when the browser can hash) or on file name + size.
 */
export const POST = route(async (req) => {
  await requireUser();
  const { items } = await body<{ items: { hash?: string; name: string; size: number }[] }>(req);
  const sourceId = uploadSourceId();
  const bySize = db.prepare('SELECT locator FROM track_copies WHERE source_id = ? AND size = ?');
  const have: boolean[] = [];
  for (const it of (items ?? []).slice(0, 5000)) {
    let found = false;
    if (it.hash && /^[a-f0-9]{16}$/.test(it.hash)) {
      const dir = path.join(UPLOAD_DIR, it.hash.slice(0, 2));
      try {
        found = fs.readdirSync(dir).some((f) => f.startsWith(it.hash + '-'));
      } catch {}
    }
    if (!found && it.name && Number.isFinite(it.size)) {
      const want = uploadKey(it.name);
      found = (bySize.all(sourceId, it.size) as { locator: string }[]).some((r) => uploadKey(path.basename(r.locator).replace(/^[a-f0-9]{16}-/, '')) === want);
    }
    have.push(found);
  }
  return { have };
});
