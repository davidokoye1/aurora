import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db';
import { startSync, syncEvents, syncProgress, getSourceRow, sourceConfig } from './sync';
import { AUDIO_EXT, IMAGE_EXT, extOf } from './sources/media';
import type { SyncProgress } from '../types';

/**
 * Keeps folder sources live:
 *  - a recursive fs.watch per folder turns file changes into a quick incremental re-scan (debounced)
 *  - folders on drives that are unplugged are re-checked every 30 s and reconnect by themselves
 *  - a safety re-scan runs every 30 min (every 2 min where watching isn't possible)
 */
const DEBOUNCE_MS = Number(process.env.AURORA_WATCH_DEBOUNCE_MS ?? 3000);
const POLL_MS = Number(process.env.AURORA_WATCH_POLL_MS ?? 30_000);
const RESCAN_MS = 30 * 60_000;
const RESCAN_UNWATCHED_MS = 2 * 60_000;

interface Watched {
  root: string;
  watcher: fs.FSWatcher | null;
  timer: NodeJS.Timeout | null;
}
interface State {
  started: boolean;
  watched: Map<string, Watched>;
  pending: Set<string>;
  poll: NodeJS.Timeout | null;
}
const g = globalThis as unknown as { __auroraWatch?: State };
const st: State = (g.__auroraWatch ??= { started: false, watched: new Map(), pending: new Set(), poll: null });

/** Is a changed path worth a re-scan? Audio, artwork and folders yes; temp/partial downloads no. */
export function relevantChange(filename: string | null): boolean {
  if (!filename) return true; // some platforms don't report the name
  const base = path.basename(filename);
  if (base.startsWith('.') || base.startsWith('~') || base.startsWith('$')) return false;
  const ext = extOf(base);
  if (['part', 'crdownload', 'tmp', 'download', 'partial', 'db', 'ini', 'lnk'].includes(ext)) return false;
  if (!ext) return true; // folder
  return !!AUDIO_EXT[ext] || IMAGE_EXT.has(ext);
}

function folderSources() {
  return (db.prepare("SELECT id FROM sources WHERE type = 'folder' AND paused = 0").all() as { id: string }[])
    .map((r) => getSourceRow(r.id)!)
    .filter(Boolean);
}

/** Start (or queue) an incremental scan. If one is running, run once more after it finishes. */
export function requestScan(sourceId: string) {
  const p = syncProgress(sourceId);
  if (p?.status === 'running') {
    st.pending.add(sourceId);
    return;
  }
  try {
    startSync(sourceId);
  } catch {
    /* source removed */
  }
}

function schedule(sourceId: string) {
  const w = st.watched.get(sourceId);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  w.timer = setTimeout(() => {
    w.timer = null;
    requestScan(sourceId);
  }, DEBOUNCE_MS);
}

function unwatch(sourceId: string) {
  const w = st.watched.get(sourceId);
  if (!w) return;
  w.watcher?.close();
  if (w.timer) clearTimeout(w.timer);
  st.watched.delete(sourceId);
}

function watch(sourceId: string, root: string) {
  const cur = st.watched.get(sourceId);
  if (cur && cur.root === root && cur.watcher) return;
  unwatch(sourceId);
  const w: Watched = { root, watcher: null, timer: null };
  st.watched.set(sourceId, w);
  if (!fs.existsSync(root)) return; // drive not connected — the poll picks it up later
  try {
    w.watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, filename) => {
      if (relevantChange(filename ? String(filename) : null)) schedule(sourceId);
    });
    w.watcher.on('error', () => {
      // usually the drive went away: drop the watcher and let a scan mark the source offline
      w.watcher?.close();
      w.watcher = null;
      schedule(sourceId);
    });
  } catch (e) {
    console.warn('[watch] cannot watch', root, (e as Error).message, '— falling back to periodic re-scans');
    w.watcher = null;
  }
}

/** Bring watchers in line with the current folder sources (call after sources are added/removed/paused). */
export function refreshWatchers() {
  const rows = folderSources();
  const ids = new Set(rows.map((r) => r.id));
  for (const id of [...st.watched.keys()]) if (!ids.has(id)) unwatch(id);
  for (const r of rows) {
    const p = sourceConfig(r).path;
    if (p) watch(r.id, path.resolve(p));
  }
}

function tick() {
  const nowMs = Date.now();
  for (const r of folderSources()) {
    const cfgPath = sourceConfig(r).path;
    if (!cfgPath) continue;
    const root = path.resolve(cfgPath);
    const there = fs.existsSync(root);
    const w = st.watched.get(r.id);
    if (r.status === 'offline') {
      if (there) {
        watch(r.id, root); // drive is back
        requestScan(r.id);
      }
      continue;
    }
    if (!there && r.status === 'ok') {
      requestScan(r.id); // drive just went away → scan marks it offline, songs are kept
      continue;
    }
    if (there && !w?.watcher) watch(r.id, root);
    const every = st.watched.get(r.id)?.watcher ? RESCAN_MS : RESCAN_UNWATCHED_MS;
    if (r.status !== 'syncing' && (!r.last_sync_at || nowMs - r.last_sync_at > every)) requestScan(r.id);
  }
}

/** Called once at server start (instrumentation.ts). */
export function startWatching() {
  if (st.started) return;
  st.started = true;
  // sources left "syncing" by a crash/restart: reset so they can run again
  db.prepare("UPDATE sources SET status = 'ok' WHERE status = 'syncing'").run();
  syncEvents.on('progress', (sourceId: string, p: SyncProgress) => {
    if (p.status !== 'running' && st.pending.delete(sourceId)) setTimeout(() => requestScan(sourceId), 500);
  });
  refreshWatchers();
  st.poll = setInterval(tick, POLL_MS);
  st.poll.unref?.();
  setTimeout(tick, 2000).unref?.();
}
