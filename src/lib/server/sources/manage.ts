import 'server-only';
import { db, now, uid } from '../db';
import { seal, unseal } from '../secret';
import type { SourceConfig, SourceType } from './types';
import type { SourceDTO } from '../../types';
import { syncProgress, type SourceRow } from '../sync';

export function toSourceDTO(row: SourceRow): SourceDTO {
  const cfg = unseal<SourceConfig>(row.config_enc) ?? {};
  const prog = syncProgress(row.id);
  return {
    id: row.id, type: row.type, name: row.name, url: row.url,
    status: row.paused ? 'paused' : (row.status as SourceDTO['status']), paused: !!row.paused, error: row.error, trackCount: row.track_count,
    lastSyncAt: row.last_sync_at, createdAt: row.created_at, health: row.health_json ? JSON.parse(row.health_json) : null,
    config: {
      hasPassword: !!cfg.password, username: cfg.username, headers: maskHeaders(cfg.headers), maxDepth: cfg.maxDepth, maxFiles: cfg.maxFiles, concurrency: cfg.concurrency,
      delayMs: cfg.delayMs, include: cfg.include, exclude: cfg.exclude, renderJs: cfg.renderJs, wideScope: cfg.wideScope, hasApiKey: !!cfg.apiKey, path: cfg.path,
    },
    job: prog ? { ...prog, log: prog.log.slice(-80) } : null,
  };
}

function maskHeaders(h?: Record<string, string>) {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = /cookie|authorization|token|key/i.test(k) ? '••••••' : v;
  return out;
}

export function createSourceRow(ownerId: string | null, type: SourceType, name: string, url: string | null, cfg: SourceConfig) {
  const id = uid();
  const { url: _u, ...rest } = cfg;
  db.prepare('INSERT INTO sources(id,owner_id,type,name,url,config_enc,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, ownerId, type, name, url, seal(rest), 'idle', now());
  return id;
}

/** Merge a config patch; masked header values and empty secrets keep their stored values. */
export function updateSourceConfig(row: SourceRow, patch: Partial<SourceConfig>) {
  const cur = unseal<SourceConfig>(row.config_enc) ?? {};
  const next: SourceConfig = { ...cur };
  for (const [k, v] of Object.entries(patch) as [keyof SourceConfig, unknown][]) {
    if (k === 'url') continue;
    if ((k === 'password' || k === 'apiKey') && (v === '' || v == null)) continue;
    if (k === 'headers' && v && typeof v === 'object') {
      const h: Record<string, string> = {};
      for (const [hk, hv] of Object.entries(v as Record<string, string>)) {
        if (!hk.trim()) continue;
        h[hk.trim().toLowerCase()] = hv === '••••••' ? cur.headers?.[hk.toLowerCase()] ?? cur.headers?.[hk] ?? '' : hv;
      }
      next.headers = h;
      continue;
    }
    (next as Record<string, unknown>)[k] = v;
  }
  db.prepare('UPDATE sources SET config_enc = ? WHERE id = ?').run(seal(next), row.id);
}

export function uploadSourceId(): string {
  const row = db.prepare("SELECT id FROM sources WHERE type = 'upload' LIMIT 1").get() as { id: string } | undefined;
  if (row) return row.id;
  return createSourceRow(null, 'upload', 'Uploads', null, {});
}

/** Register MUSIC_DIR as a folder source on first boot. */
export function ensureMusicDirSource() {
  const dir = process.env.MUSIC_DIR;
  if (!dir) return null;
  const rows = db.prepare("SELECT id, config_enc FROM sources WHERE type = 'folder'").all() as { id: string; config_enc: string }[];
  for (const r of rows) if (unseal<SourceConfig>(r.config_enc)?.path === dir) return null;
  return createSourceRow(null, 'folder', 'Server music folder', null, { path: dir });
}
