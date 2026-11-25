import 'server-only';
import { db, now, norm } from './db';
import { metaClient } from './net';
import { serverEnrichment } from './background';

export interface Lyrics {
  synced: { t: number; text: string }[] | null;
  plain: string | null;
  source: string | null;
}

export function parseLRC(lrc: string): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = [];
  let offset = 0;
  for (const line of lrc.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(line);
    if (off) offset = Number(off[1]) / 1000;
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) out.push({ t: Math.max(0, Number(s[1]) * 60 + Number(s[2].replace(':', '.')) - offset), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function fromRow(r: { synced: string | null; plain: string | null; source: string | null }): Lyrics {
  return { synced: r.synced ? parseLRC(r.synced) : null, plain: r.plain, source: r.source };
}

interface LrcLibItem { trackName: string; artistName: string; albumName?: string; duration?: number; plainLyrics?: string | null; syncedLyrics?: string | null; instrumental?: boolean }

export async function getLyrics(trackId: string, force = false): Promise<Lyrics> {
  const cached = db.prepare('SELECT synced, plain, source, fetched_at FROM lyrics WHERE track_id = ?').get(trackId) as
    | { synced: string | null; plain: string | null; source: string | null; fetched_at: number }
    | undefined;
  if (cached && !force && (cached.synced || cached.plain || now() - cached.fetched_at < 7 * 86_400_000)) return fromRow(cached);
  const t = db.prepare('SELECT id, title, artist_name, album_title, duration, kind FROM tracks WHERE id = ?').get(trackId) as
    | { id: string; title: string; artist_name: string; album_title: string | null; duration: number | null; kind: string }
    | undefined;
  if (!t) return { synced: null, plain: null, source: null };

  let synced: string | null = null;
  let plain: string | null = null;
  let source: string | null = null;

  // 1. Embedded lyrics in local files
  try {
    const { resolveCopy } = await import('./stream');
    const target = await resolveCopy(trackId);
    if (target?.kind === 'file') {
      const { parseFile } = await import('music-metadata');
      const m = await parseFile(target.path, { skipCovers: true, duration: false });
      const ly = m.common.lyrics?.[0] as unknown as { text?: string; syncText?: { text: string; timestamp?: number }[] } | string | undefined;
      if (typeof ly === 'string') plain = ly;
      else if (ly) {
        if (ly.syncText?.length && ly.syncText.some((s) => s.timestamp != null)) {
          synced = ly.syncText.map((s) => `[${fmt((s.timestamp ?? 0) / 1000)}]${s.text}`).join('\n');
        }
        plain = ly.text ?? (ly.syncText?.map((s) => s.text).join('\n') || null);
      }
      if (plain && /^\s*\[\d{1,2}:\d{2}/.test(plain)) {
        synced = plain;
        plain = parseLRC(plain).map((l) => l.text).join('\n');
      }
      if (synced || plain) source = 'Embedded';
    }
  } catch {}

  // 2. LRCLIB
  if (!synced && t.kind === 'music' && serverEnrichment().lyrics && !/^unknown/i.test(t.artist_name)) {
    const c = metaClient('lrclib.net', 250);
    try {
      const params = new URLSearchParams({ artist_name: t.artist_name, track_name: t.title });
      if (t.album_title) params.set('album_name', t.album_title);
      if (t.duration) params.set('duration', String(Math.round(t.duration)));
      let item: LrcLibItem | null = null;
      try {
        item = await c.json<LrcLibItem>(`https://lrclib.net/api/get?${params}`);
      } catch {
        item = null;
      }
      if (!item || (!item.syncedLyrics && !item.plainLyrics)) {
        const res = await c.json<LrcLibItem[]>(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: t.title, artist_name: t.artist_name })}`);
        const ranked = res
          .filter((r) => norm(r.artistName).includes(norm(t.artist_name).split(' ')[0] ?? '') || norm(t.artist_name).includes(norm(r.artistName)))
          .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || Math.abs((a.duration ?? 0) - (t.duration ?? 0)) - Math.abs((b.duration ?? 0) - (t.duration ?? 0)));
        item = ranked.find((r) => !t.duration || !r.duration || Math.abs(r.duration - t.duration) < 8) ?? null;
      }
      if (item) {
        if (item.syncedLyrics) synced = item.syncedLyrics;
        if (item.plainLyrics) plain = plain ?? item.plainLyrics;
        if (item.instrumental && !plain) plain = '♪ Instrumental';
        if (synced || plain) source = source ?? 'LRCLIB';
      }
    } catch {}
  }
  db.prepare('INSERT OR REPLACE INTO lyrics(track_id, synced, plain, source, fetched_at) VALUES (?,?,?,?,?)').run(trackId, synced, plain, source, now());
  return { synced: synced ? parseLRC(synced) : null, plain, source };
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
