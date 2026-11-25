import 'server-only';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { db, now, uid, norm } from './db';
import { HttpClient } from './net';
import { unseal } from './secret';
import { ADAPTERS, subsonicArtUrl, jellyfinBase, DriveMissingError } from './sources/adapters';
import type { RawTrack, SourceConfig, SourceType } from './sources/types';
import { upsertTrack, pruneSource, saveArt } from './catalog';
import { readLocalTags, readRemoteTags } from './tags';
import { sniffAudio } from './sources/media';
import type { SourceHealth, SyncProgress } from '../types';
import { scheduleBackground } from './background';

export interface SourceRow {
  id: string; owner_id: string | null; type: SourceType; name: string; url: string | null; config_enc: string | null; status: string; paused: number;
  error: string | null; health_json: string | null; track_count: number; last_sync_at: number | null; created_at: number;
}

interface Running {
  progress: SyncProgress;
  abort: AbortController;
}
const g = globalThis as unknown as { __auroraSync?: { running: Map<string, Running>; emitter: EventEmitter; last: Map<string, SyncProgress> } };
const state = (g.__auroraSync ??= { running: new Map(), emitter: new EventEmitter(), last: new Map() });
state.emitter.setMaxListeners(200);

export const syncEvents = state.emitter;
export function syncProgress(sourceId: string): SyncProgress | null {
  return state.running.get(sourceId)?.progress ?? state.last.get(sourceId) ?? null;
}

export function getSourceRow(id: string) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
}

export function sourceConfig(row: SourceRow): SourceConfig {
  const cfg = unseal<SourceConfig>(row.config_enc) ?? {};
  if (row.url) cfg.url = row.url;
  return cfg;
}

/** HTTP Basic credentials only apply to plain web sources; API sources use their own auth. */
export function clientForSource(row: SourceRow, cfg = sourceConfig(row)) {
  const basic = row.type === 'http' || row.type === 'playlist' || row.type === 'manifest' || row.type === 'rss';
  return new HttpClient({ headers: cfg.headers, username: basic ? cfg.username : undefined, password: basic ? cfg.password : undefined, delayMs: cfg.delayMs, concurrency: cfg.concurrency ?? 4 });
}

async function resolveArt(client: HttpClient, row: SourceRow, cfg: SourceConfig, ref: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(ref)) return cache.get(ref)!;
  let out: string | null = null;
  try {
    if (ref.startsWith('file:')) {
      out = saveArt(fs.readFileSync(ref.slice(5)));
    } else {
      let url = ref;
      let headers: Record<string, string> | undefined;
      if (ref.startsWith('subsonic-art:')) url = subsonicArtUrl(cfg, ref.slice(13));
      else if (ref.startsWith('jellyfin-art:')) {
        url = `${jellyfinBase(cfg.url!)}/Items/${ref.slice(13)}/Images/Primary?maxWidth=600&quality=90`;
        const token = cfg.apiKey ?? (cfg as SourceConfig & { _token?: string })._token;
        if (token) headers = { 'x-emby-token': token };
      }
      const r = await client.request(url, { headers });
      if (r.status < 300) {
        const { readLimited } = await import('./net');
        const bytes = await readLimited(r.body, 12 * 1024 * 1024);
        out = saveArt(bytes, r.headers.get('content-type') ?? undefined);
      } else await r.body?.cancel().catch(() => {});
    }
  } catch {
    out = null;
  }
  void row;
  cache.set(ref, out);
  return out;
}

export async function readTagsFor(row: SourceRow, cfg: SourceConfig, client: HttpClient, raw: RawTrack): Promise<RawTrack> {
  const adapter = ADAPTERS[row.type];
  const target = adapter.resolve(raw.locator, cfg);
  if (target.kind === 'file') return readLocalTags(target.path, raw);
  if (target.kind === 'url') return readRemoteTags(client, target.url, raw, target.headers);
  return raw;
}

function emit(sourceId: string, p: SyncProgress) {
  state.emitter.emit('progress', sourceId, { ...p, log: p.log.slice(-50) });
}

export function startSync(sourceId: string): SyncProgress {
  const existing = state.running.get(sourceId);
  if (existing) return existing.progress;
  const row = getSourceRow(sourceId);
  if (!row) throw new Error('Source not found');
  const jobId = uid();
  const progress: SyncProgress = { jobId, status: 'running', pages: 0, found: 0, imported: 0, errors: 0, log: [], startedAt: now(), finishedAt: null };
  const abort = new AbortController();
  state.running.set(sourceId, { progress, abort });
  db.prepare('INSERT INTO sync_jobs(id,source_id,status,started_at) VALUES (?,?,?,?)').run(jobId, sourceId, 'running', progress.startedAt);
  db.prepare("UPDATE sources SET status = 'syncing', error = NULL WHERE id = ?").run(sourceId);
  emit(sourceId, progress);
  void runSync(row, progress, abort).catch((e) => console.error('[sync] crashed', e));
  return progress;
}

export function cancelSync(sourceId: string) {
  state.running.get(sourceId)?.abort.abort();
}

async function runSync(row: SourceRow, progress: SyncProgress, abort: AbortController) {
  const cfg = sourceConfig(row);
  const client = clientForSource(row, cfg);
  const adapter = ADAPTERS[row.type];
  const stamp = progress.startedAt;
  const artCache = new Map<string, string | null>();
  const playlists: { name: string; locators: string[] }[] = [];
  const seen = new Set<string>();
  const log = (m: string) => {
    progress.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    if (progress.log.length > 400) progress.log.splice(0, progress.log.length - 400);
  };
  let lastEmit = 0;
  const tick = (force = false) => {
    if (force || Date.now() - lastEmit > 300) {
      lastEmit = Date.now();
      emit(row.id, progress);
      db.prepare('UPDATE sync_jobs SET pages=?, found=?, imported=?, errors=? WHERE id=?').run(progress.pages, progress.found, progress.imported, progress.errors, progress.jobId);
    }
  };

  const poolSize = Math.max(1, Math.min(8, cfg.concurrency ?? 4));
  const inflight = new Set<Promise<void>>();
  // Incremental re-scans: a local file with the same size and modified time is unchanged — just mark it seen.
  const sameFile = db.prepare('SELECT id FROM track_copies WHERE source_id = ? AND locator = ? AND size = ? AND file_mtime = ?');
  const touch = db.prepare('UPDATE track_copies SET last_seen = ? WHERE id = ?');
  const processOne = async (raw: RawTrack) => {
    try {
      if (raw.mtime != null && raw.size != null) {
        const same = sameFile.get(row.id, raw.locator, raw.size, raw.mtime) as { id: string } | undefined;
        if (same) {
          touch.run(stamp, same.id);
          progress.unchanged = (progress.unchanged ?? 0) + 1;
          tick();
          return;
        }
      }
      let t = raw;
      if (raw.needsTags) {
        try {
          t = await readTagsFor(row, cfg, client, raw);
        } catch (e) {
          if (progress.errors < 30) log(`Tags unreadable for ${raw.locator.slice(0, 120)}: ${(e as Error).message}`);
        }
      }
      let cover: string | null = null;
      if (t.coverData) cover = saveArt(t.coverData.data, t.coverData.mime);
      if (!cover && t.coverUrl) cover = await resolveArt(client, row, cfg, t.coverUrl, artCache);
      upsertTrack({ ...t, coverData: undefined }, row.id, stamp, cover);
      progress.imported++;
    } catch (e) {
      progress.errors++;
      if (progress.errors < 50) log(`Failed to import ${raw.locator.slice(0, 120)}: ${(e as Error).message}`);
    }
    tick();
  };

  let fatal: string | null = null;
  let driveMissing = false;
  try {
    log(`Sync started (${row.type}).`);
    const gen = adapter.sync({
      client,
      config: cfg,
      signal: abort.signal,
      log: (m) => {
        log(m);
        tick();
      },
      page: () => {
        progress.pages++;
        tick();
      },
      playlist: (name, locators) => playlists.push({ name, locators }),
    });
    const maxFiles = cfg.maxFiles ?? 200_000;
    for await (const raw of gen) {
      if (abort.signal.aborted) break;
      if (progress.found >= maxFiles) {
        log(`Reached the limit of ${maxFiles} files for this source.`);
        break;
      }
      if (seen.has(raw.locator)) continue;
      seen.add(raw.locator);
      progress.found++;
      const p = processOne(raw).finally(() => inflight.delete(p));
      inflight.add(p);
      if (inflight.size >= poolSize) await Promise.race(inflight);
    }
    await Promise.all(inflight);
  } catch (e) {
    await Promise.allSettled(inflight);
    if (e instanceof DriveMissingError) {
      driveMissing = true;
      log('The folder isn’t reachable — is the drive plugged in? Your songs are kept and will come back when it is.');
    } else {
      fatal = (e as Error).message;
      log(`Error: ${fatal}`);
    }
  }

  const cancelled = abort.signal.aborted;
  if (!fatal && !cancelled && !driveMissing) {
    const removed = pruneSource(row.id, stamp);
    if (removed) log(`Removed ${removed} tracks that are no longer in this source.`);
    try {
      importSourcePlaylists(row, playlists);
    } catch (e) {
      log(`Playlists: ${(e as Error).message}`);
    }
  }
  const health = fatal || driveMissing ? null : await healthCheck(row, cfg, client).catch(() => null);
  const count = (db.prepare('SELECT count(DISTINCT track_id) c FROM track_copies WHERE source_id = ?').get(row.id) as { c: number }).c;
  progress.status = cancelled ? 'cancelled' : fatal ? 'error' : 'done';
  progress.finishedAt = now();
  log(
    cancelled ? 'Sync cancelled.' : fatal ? 'Sync failed.' : driveMissing ? 'Waiting for the drive.'
      : progress.unchanged ? `Scan finished: ${progress.imported} new or changed, ${progress.unchanged} unchanged.` : `Sync finished: ${progress.imported} tracks imported${progress.pages ? ` from ${progress.pages} pages` : ''}.`,
  );
  if (!fatal && !cancelled && !driveMissing && progress.found === 0) log('No audio was found. Check the URL, the access options, or try "Render JavaScript".');
  db.prepare('UPDATE sync_jobs SET status=?, pages=?, found=?, imported=?, errors=?, log=?, finished_at=? WHERE id=?').run(
    progress.status, progress.pages, progress.found, progress.imported, progress.errors, progress.log.join('\n'), progress.finishedAt, progress.jobId,
  );
  db.prepare('UPDATE sources SET status=?, error=?, track_count=?, last_sync_at=?, health_json=COALESCE(?, health_json) WHERE id=?').run(
    fatal ? 'error' : driveMissing ? 'offline' : 'ok',
    fatal ?? (driveMissing ? 'Drive not connected' : progress.found === 0 && !cancelled ? (row.type === 'folder' ? 'No audio files in this folder yet.' : 'No audio found at this URL.') : null),
    count, now(), health ? JSON.stringify(health) : null, row.id,
  );
  state.running.delete(row.id);
  state.last.set(row.id, progress);
  emit(row.id, progress);
  scheduleBackground();
}

function importSourcePlaylists(row: SourceRow, playlists: { name: string; locators: string[] }[]) {
  if (!row.owner_id || !playlists.length) return;
  for (const p of playlists) {
    const origin = `source:${row.id}:${norm(p.name)}`;
    const ids: string[] = [];
    for (const l of p.locators) {
      const c = db.prepare('SELECT track_id FROM track_copies WHERE source_id = ? AND locator = ?').get(row.id, l) as { track_id: string } | undefined;
      if (c && !ids.includes(c.track_id)) ids.push(c.track_id);
    }
    if (!ids.length) continue;
    let pl = db.prepare('SELECT id FROM playlists WHERE origin = ? AND owner_id = ?').get(origin, row.owner_id) as { id: string } | undefined;
    if (!pl) {
      pl = { id: uid() };
      db.prepare('INSERT INTO playlists(id,owner_id,name,description,origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(
        pl.id, row.owner_id, p.name, `Imported from ${row.name}`, origin, now(), now(),
      );
    }
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(pl.id);
    const ins = db.prepare('INSERT INTO playlist_tracks(id,playlist_id,track_id,position,added_by,added_at) VALUES (?,?,?,?,?,?)');
    ids.forEach((id, i) => ins.run(uid(), pl!.id, id, i + 1, row.owner_id, now()));
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), pl.id);
  }
}

/** Verify a sample of imported copies actually stream audio. */
async function healthCheck(row: SourceRow, cfg: SourceConfig, client: HttpClient): Promise<SourceHealth> {
  const sample = db.prepare('SELECT id, locator, format FROM track_copies WHERE source_id = ? ORDER BY random() LIMIT 6').all(row.id) as { id: string; locator: string; format: string | null }[];
  const unplayable = (db.prepare('SELECT DISTINCT format FROM track_copies WHERE source_id = ? AND playable = 0').all(row.id) as { format: string | null }[]).map((r) => r.format ?? 'unknown');
  const errors: string[] = [];
  let ok = 0;
  let range: boolean | null = null;
  const adapter = ADAPTERS[row.type];
  for (const s of sample) {
    try {
      const target = adapter.resolve(s.locator, cfg);
      if (target.kind === 'file') {
        if (fs.existsSync(target.path)) ok++;
        else errors.push(`Missing file ${target.path}`);
        range = true;
        continue;
      }
      if (target.kind === 'zip') {
        ok++;
        continue;
      }
      const h = await client.head(target.url, 64);
      if (h.status >= 400) {
        errors.push(`HTTP ${h.status} for a sample track`);
        continue;
      }
      range = range === false ? false : h.ranged;
      if (sniffAudio(h.bytes) || (h.headers.get('content-type') ?? '').startsWith('audio/')) ok++;
      else errors.push(`A sample link didn't return audio (${h.headers.get('content-type') ?? 'unknown type'})`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { checkedAt: now(), sampled: sample.length, playable: ok, rangeSupport: range, unplayableFormats: unplayable, errors: [...new Set(errors)].slice(0, 5) };
}

/** Resume: mark any sources left "syncing" by a crash as idle. */
db.prepare("UPDATE sources SET status = 'idle' WHERE status = 'syncing'").run();
db.prepare("UPDATE sync_jobs SET status = 'error', finished_at = ? WHERE status = 'running'").run(now());
