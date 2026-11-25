import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { UPLOAD_DIR, db } from '@/lib/server/db';
import { uploadSourceId } from '@/lib/server/sources/manage';
import { AUDIO_EXT, extOf, sniffAudio } from '@/lib/server/sources/media';
import { readLocalTags } from '@/lib/server/tags';
import { saveArt, upsertTrack } from '@/lib/server/catalog';
import { scheduleBackground } from '@/lib/server/background';

export const maxDuration = 300;

/** Accepts multipart uploads (one or many files, optionally with relative folder paths). */
export const POST = route(async (req) => {
  await requireUser();
  const form = await req.formData().catch(() => {
    throw new HttpError(400, 'Expected multipart form data.');
  });
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  const paths = form.getAll('paths').map(String);
  if (!files.length) throw new HttpError(400, 'No files received.');
  const sourceId = uploadSourceId();
  const stamp = Date.now();
  const results: { name: string; ok: boolean; trackId?: string; error?: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = (paths[i] || f.name).replace(/\\/g, '/').replace(/^\/+/, '');
    try {
      const buf = Buffer.from(await f.arrayBuffer());
      const sniff = sniffAudio(buf.subarray(0, 64));
      const ext = extOf(f.name) || sniff?.format || '';
      if (!AUDIO_EXT[ext] && !sniff) throw new Error('Not a supported audio file');
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
      const dir = path.join(UPLOAD_DIR, hash.slice(0, 2));
      fs.mkdirSync(dir, { recursive: true });
      const safeBase = path.basename(rel).replace(/[^\p{L}\p{N}._ ()\[\]&,'-]+/gu, '_').slice(0, 120);
      const file = path.join(dir, `${hash}-${safeBase}`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      const locator = path.relative(UPLOAD_DIR, file);
      const stat = fs.statSync(file);
      const base = { locator, pathHint: rel, format: ext || sniff?.format, needsTags: false, size: stat.size, mtime: Math.floor(stat.mtimeMs) };
      const t = { ...(await readLocalTags(file, base).catch(() => base)), size: stat.size, mtime: Math.floor(stat.mtimeMs) };
      const cover = 'coverData' in t && t.coverData ? saveArt(t.coverData.data, t.coverData.mime) : null;
      const trackId = upsertTrack({ ...t, coverData: undefined }, sourceId, stamp, cover);
      results.push({ name: rel, ok: true, trackId });
    } catch (e) {
      results.push({ name: rel, ok: false, error: (e as Error).message });
    }
  }
  const count = (db.prepare('SELECT count(DISTINCT track_id) c FROM track_copies WHERE source_id = ?').get(sourceId) as { c: number }).c;
  db.prepare("UPDATE sources SET track_count = ?, last_sync_at = ?, status = 'ok' WHERE id = ?").run(count, Date.now(), sourceId);
  scheduleBackground();
  return { results, imported: results.filter((r) => r.ok).length };
});
