import 'server-only';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { db } from './db';
import { ADAPTERS } from './sources/adapters';
import { extractZipEntry } from './sources/zip';
import { getSourceRow, sourceConfig, clientForSource, type SourceRow } from './sync';
import { AUDIO_EXT, extOf, sniffAudio } from './sources/media';
import { readLocalTags } from './tags';
import { upsertTrack, saveArt } from './catalog';
import type { HttpClient } from './net';

export interface CopyRow {
  id: string; track_id: string; source_id: string; locator: string; format: string | null; mime: string | null; bitrate: number | null; size: number | null; playable: number; failures: number;
}

export type Target =
  | { kind: 'file'; path: string; mime: string; copy: CopyRow; source: SourceRow }
  | { kind: 'url'; url: string; headers?: Record<string, string>; mime: string; copy: CopyRow; source: SourceRow; client: HttpClient };

const QUALITY: Record<string, number> = { flac: 6, wav: 5, alac: 5, m4a: 3, opus: 3, ogg: 3, mp3: 2, aac: 2, webm: 2 };

export function rankCopies(copies: CopyRow[], prefer: 'best' | 'smallest' = 'best') {
  return [...copies].sort((a, b) => {
    if (a.playable !== b.playable) return b.playable - a.playable;
    if (a.failures !== b.failures) return a.failures - b.failures;
    const qa = (QUALITY[a.format ?? ''] ?? 1) * 1000 + (a.bitrate ?? 0);
    const qb = (QUALITY[b.format ?? ''] ?? 1) * 1000 + (b.bitrate ?? 0);
    return prefer === 'best' ? qb - qa : qa - qb;
  });
}

export async function resolveCopy(trackId: string, opts: { copyId?: string; prefer?: 'best' | 'smallest'; skip?: string[] } = {}): Promise<Target | null> {
  const copies = db
    .prepare(`SELECT c.* FROM track_copies c JOIN sources s ON s.id = c.source_id WHERE c.track_id = ? AND s.paused = 0`)
    .all(trackId) as CopyRow[];
  const ranked = opts.copyId ? copies.filter((c) => c.id === opts.copyId) : rankCopies(copies, opts.prefer).filter((c) => !opts.skip?.includes(c.id));
  for (const copy of ranked) {
    const source = getSourceRow(copy.source_id);
    if (!source) continue;
    const cfg = sourceConfig(source);
    const target = ADAPTERS[source.type].resolve(copy.locator, cfg);
    const mime = copy.mime?.startsWith('audio/') ? copy.mime : AUDIO_EXT[copy.format ?? extOf(copy.locator)]?.mime ?? 'audio/mpeg';
    if (target.kind === 'file') {
      if (!fs.existsSync(target.path)) continue;
      return { kind: 'file', path: target.path, mime, copy, source };
    }
    const client = clientForSource(source, cfg);
    if (target.kind === 'zip') {
      try {
        const file = await extractZipEntry(client, target.zipUrl, target.entry);
        void refreshZipTags(copy, source, file);
        return { kind: 'file', path: file, mime, copy, source };
      } catch {
        continue;
      }
    }
    if (source.type === 'jellyfin' && !cfg.apiKey) {
      const { jellyfinToken } = await import('./sources/adapters');
      const tok = await jellyfinToken(client, cfg).catch(() => null);
      if (!tok) continue;
      (cfg as { _token?: string })._token = tok.token;
      const t2 = ADAPTERS.jellyfin.resolve(copy.locator, cfg);
      if (t2.kind === 'url') return { kind: 'url', url: t2.url, mime, copy, source, client };
    }
    return { kind: 'url', url: target.url, headers: target.headers, mime, copy, source, client };
  }
  return null;
}

const refreshed = new Set<string>();
/** Zip entries are imported by filename only; once extracted, read their real tags. */
async function refreshZipTags(copy: CopyRow, source: SourceRow, file: string) {
  if (refreshed.has(copy.id)) return;
  refreshed.add(copy.id);
  try {
    const t = await readLocalTags(file, { locator: copy.locator, pathHint: copy.locator.split('#').pop(), format: copy.format });
    const cover = t.coverData ? saveArt(t.coverData.data, t.coverData.mime) : null;
    const last = db.prepare('SELECT last_seen FROM track_copies WHERE id = ?').get(copy.id) as { last_seen: number } | undefined;
    upsertTrack({ ...t, coverData: undefined }, source.id, last?.last_seen ?? 0, cover);
  } catch {}
}

function parseRange(h: string | null, size: number): [number, number] | null {
  if (!h) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(h);
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start)) {
    start = size - Number(m[2]);
    end = size - 1;
  }
  if (start < 0 || start >= size || end < start) return null;
  return [start, Math.min(end, size - 1)];
}

export function serveFile(path: string, mime: string, req: Request, extra: Record<string, string> = {}): Response {
  const size = fs.statSync(path).size;
  const range = parseRange(req.headers.get('range'), size);
  const headers: Record<string, string> = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', ...extra };
  if (req.headers.get('range') && !range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  if (range) {
    const [s, e] = range;
    const stream = fs.createReadStream(path, { start: s, end: e });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers: { ...headers, 'content-length': String(e - s + 1), 'content-range': `bytes ${s}-${e}/${size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(path)) as ReadableStream, { status: 200, headers: { ...headers, 'content-length': String(size) } });
}

/** Skip the first n bytes of a web stream (used to emulate Range on servers that don't support it). */
function skipBytes(body: ReadableStream<Uint8Array>, n: number): ReadableStream<Uint8Array> {
  let skipped = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        if (skipped >= n) return ctl.enqueue(chunk);
        const need = n - skipped;
        if (chunk.byteLength <= need) {
          skipped += chunk.byteLength;
          return;
        }
        skipped = n;
        ctl.enqueue(chunk.subarray(need));
      },
    }),
  );
}

/** Proxy a remote stream with Range passthrough (and emulation when upstream ignores Range). */
export async function serveUrl(t: Extract<Target, { kind: 'url' }>, req: Request): Promise<Response> {
  const range = req.headers.get('range');
  const up = await t.client.request(t.url, { headers: { ...(t.headers ?? {}), ...(range ? { range } : {}) }, signal: req.signal, noThrottle: true, noRetry: false });
  if (up.status >= 400) {
    await up.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`Upstream HTTP ${up.status}`), { upstream: up.status });
  }
  const ct = up.headers.get('content-type') ?? '';
  const mime = ct.startsWith('audio/') || ct.startsWith('video/') || ct.includes('ogg') ? ct : t.mime;
  const headers: Record<string, string> = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
  const len = up.headers.get('content-length');
  if (up.status === 206) {
    if (len) headers['content-length'] = len;
    const cr = up.headers.get('content-range');
    if (cr) headers['content-range'] = cr;
    return new Response(up.body, { status: 206, headers });
  }
  // Upstream returned the whole file
  const total = len ? Number(len) : null;
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (m && total) {
    const start = Number(m[1]);
    if (start >= total) {
      await up.body?.cancel().catch(() => {});
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    }
    const body = start > 0 ? skipBytes(up.body!, start) : up.body!;
    return new Response(body, { status: 206, headers: { ...headers, 'content-length': String(total - start), 'content-range': `bytes ${start}-${total - 1}/${total}` } });
  }
  if (total) headers['content-length'] = String(total);
  else delete headers['accept-ranges'];
  return new Response(up.body, { status: 200, headers });
}

export { sniffAudio };
