import 'server-only';
import { spawn } from 'node:child_process';
import { db, now, norm } from './db';
import { metaClient, readLimited } from './net';
import { saveArt } from './catalog';
import { DEFAULT_SETTINGS, type UserSettings } from '../types';

/**
 * Background work after syncs: metadata enrichment (MusicBrainz, Cover Art Archive, Wikidata/Wikipedia)
 * and audio-feature analysis (ffmpeg → BPM / energy / brightness / loudness).
 */
const g = globalThis as unknown as { __auroraBg?: { timer: NodeJS.Timeout | null; running: boolean; again: boolean; hasFfmpeg: boolean | null } };
const st = (g.__auroraBg ??= { timer: null, running: false, again: false, hasFfmpeg: null });

export function serverEnrichment(): UserSettings['enrichment'] {
  const row = db.prepare("SELECT s.json FROM user_settings s JOIN users u ON u.id = s.user_id WHERE u.is_admin = 1 ORDER BY u.created_at LIMIT 1").get() as { json: string } | undefined;
  const s = row ? (JSON.parse(row.json) as Partial<UserSettings>) : {};
  return { ...DEFAULT_SETTINGS.enrichment, ...(s.enrichment ?? {}) };
}

export function scheduleBackground(delay = 1500) {
  if (st.running) {
    st.again = true;
    return;
  }
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(() => void run(), delay);
}

async function run() {
  st.timer = null;
  st.running = true;
  try {
    const en = serverEnrichment();
    if (en.musicbrainz || en.coverart) {
      await enrichAlbums(en);
      if (en.musicbrainz) await enrichArtists();
    }
    await analyseFeatures();
  } catch (e) {
    console.error('[background]', e);
  } finally {
    st.running = false;
    if (st.again) {
      st.again = false;
      scheduleBackground(5000);
    }
  }
}

const MB = 'https://musicbrainz.org/ws/2';
const mb = () => metaClient('musicbrainz.org', 1100);
const caa = () => metaClient('coverartarchive.org', 300);
const wiki = () => metaClient('wikimedia', 300);
const q = (s: string) => `"${s.replace(/["\\]/g, ' ')}"`;

async function fetchImage(client: ReturnType<typeof metaClient>, url: string): Promise<string | null> {
  try {
    const r = await client.request(url);
    if (r.status >= 300) {
      await r.body?.cancel().catch(() => {});
      return null;
    }
    return saveArt(await readLimited(r.body, 10 * 1024 * 1024), r.headers.get('content-type') ?? undefined);
  } catch {
    return null;
  }
}

async function enrichAlbums(en: UserSettings['enrichment']) {
  const albums = db
    .prepare(
      `SELECT a.id, a.title, a.year, a.cover, ar.name artist FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
       WHERE a.enriched_at IS NULL AND (a.cover IS NULL OR a.year IS NULL)
       AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.kind = 'podcast') LIMIT 400`,
    )
    .all() as { id: string; title: string; year: number | null; cover: string | null; artist: string | null }[];
  for (const a of albums) {
    let mbid: string | null = null;
    let rg: string | null = null;
    let year: number | null = null;
    try {
      const artistQ = a.artist && !/unknown|various/i.test(a.artist) ? ` AND artist:${q(a.artist)}` : '';
      const r = await mb().json<{ releases?: { id: string; score: number; date?: string; title: string; 'release-group'?: { id: string } }[] }>(
        `${MB}/release/?query=${encodeURIComponent(`release:${q(a.title)}${artistQ}`)}&fmt=json&limit=5`,
      );
      const best = (r.releases ?? []).find((x) => x.score >= 90 && norm(x.title) === norm(a.title)) ?? (r.releases ?? []).find((x) => x.score >= 97);
      if (best) {
        mbid = best.id;
        rg = best['release-group']?.id ?? null;
        year = best.date ? Number(best.date.slice(0, 4)) || null : null;
      }
    } catch {}
    let cover: string | null = null;
    if (!a.cover && en.coverart && (mbid || rg)) {
      if (rg) cover = await fetchImage(caa(), `https://coverartarchive.org/release-group/${rg}/front-500`);
      if (!cover && mbid) cover = await fetchImage(caa(), `https://coverartarchive.org/release/${mbid}/front-500`);
    }
    db.prepare('UPDATE albums SET mbid = COALESCE(mbid, ?), year = COALESCE(year, ?), cover = COALESCE(cover, ?), enriched_at = ? WHERE id = ?').run(mbid, year, cover, now(), a.id);
    if (year) db.prepare('UPDATE tracks SET year = ? WHERE album_id = ? AND year IS NULL').run(year, a.id);
  }
}

async function enrichArtists() {
  const artists = db
    .prepare(`SELECT id, name FROM artists WHERE enriched_at IS NULL AND name NOT LIKE 'Unknown%' AND name NOT LIKE 'Various%' LIMIT 300`)
    .all() as { id: string; name: string }[];
  for (const a of artists) {
    let mbid: string | null = null;
    let tags: string[] = [];
    let image: string | null = null;
    let bio: string | null = null;
    try {
      const r = await mb().json<{ artists?: { id: string; score: number; name: string; tags?: { name: string; count: number }[] }[] }>(
        `${MB}/artist/?query=${encodeURIComponent(`artist:${q(a.name)}`)}&fmt=json&limit=3`,
      );
      const best = (r.artists ?? []).find((x) => x.score >= 95 && norm(x.name) === norm(a.name));
      if (best) {
        mbid = best.id;
        tags = (best.tags ?? []).sort((x, y) => y.count - x.count).slice(0, 8).map((t) => t.name);
        const d = await mb().json<{ relations?: { type: string; url?: { resource: string } }[]; genres?: { name: string; count: number }[] }>(
          `${MB}/artist/${mbid}?inc=url-rels+genres&fmt=json`,
        );
        if (d.genres?.length) tags = d.genres.sort((x, y) => y.count - x.count).slice(0, 8).map((x) => x.name);
        const wd = d.relations?.find((x) => x.type === 'wikidata')?.url?.resource;
        const qid = wd ? /Q\d+/.exec(wd)?.[0] : null;
        if (qid) {
          const ent = await wiki().json<{ entities: Record<string, { claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>; sitelinks?: Record<string, { title: string }> }> }>(
            `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
          );
          const e = ent.entities[qid];
          const file = e?.claims?.P18?.[0]?.mainsnak.datavalue?.value as string | undefined;
          if (file) image = await fetchImage(wiki(), `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`);
          const title = e?.sitelinks?.enwiki?.title;
          if (title) {
            const s = await wiki().json<{ extract?: string }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`).catch(() => null);
            bio = s?.extract ?? null;
          }
        }
      }
    } catch {}
    db.prepare('UPDATE artists SET mbid = COALESCE(mbid, ?), tags = COALESCE(?, tags), image = COALESCE(image, ?), bio = COALESCE(bio, ?), enriched_at = ? WHERE id = ?').run(
      mbid, tags.length ? JSON.stringify(tags) : null, image, bio, now(), a.id,
    );
    if (tags.length) db.prepare('UPDATE tracks SET genre = ? WHERE artist_id = ? AND genre IS NULL').run(titleCase(tags[0]), a.id);
  }
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ audio features */

let ffmpegBin = 'ffmpeg';
const tryBin = (bin: string) =>
  new Promise<boolean>((res) => {
    try {
      const p = spawn(bin, ['-version']);
      p.on('error', () => res(false));
      p.on('exit', (c) => res(c === 0));
    } catch {
      res(false);
    }
  });

/** Use ffmpeg from the PATH if there is one, otherwise the copy bundled with Aurora (ffmpeg-static). */
async function ffmpegAvailable() {
  if (st.hasFfmpeg !== null) return st.hasFfmpeg;
  if (await tryBin('ffmpeg')) st.hasFfmpeg = true;
  else {
    let bundled: string | null = null;
    try {
      bundled = (await import('ffmpeg-static')).default as unknown as string | null;
    } catch {}
    st.hasFfmpeg = !!bundled && (await tryBin(bundled));
    if (st.hasFfmpeg) ffmpegBin = bundled!;
  }
  return st.hasFfmpeg;
}

export interface Features {
  bpm: number | null;
  energy: number;
  brightness: number;
  loudness: number;
  duration?: number;
}

/** Pure DSP over mono float PCM. Exported for tests. */
export function computeFeatures(pcm: Float32Array, sr: number): Features {
  const n = pcm.length;
  if (n < sr) return { bpm: null, energy: 0, brightness: 0, loudness: -60 };
  let sum = 0;
  let zc = 0;
  for (let i = 0; i < n; i++) {
    sum += pcm[i] * pcm[i];
    if (i && (pcm[i] >= 0) !== (pcm[i - 1] >= 0)) zc++;
  }
  const rms = Math.sqrt(sum / n);
  const loudness = 20 * Math.log10(rms + 1e-9);
  const zcrHz = (zc / n) * sr / 2;
  const brightness = Math.max(0, Math.min(1, zcrHz / 2500));

  // Onset envelope (positive energy flux on ~23ms frames)
  const hop = Math.round(sr / 86);
  const frames = Math.floor(n / hop);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += Math.abs(pcm[i]);
    e /= hop;
    env[f] = Math.max(0, e - prev);
    prev = e;
  }
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  for (let f = 0; f < frames; f++) env[f] -= mean;
  const fps = sr / hop;
  let bestLag = 0;
  let best = -Infinity;
  const minLag = Math.floor((fps * 60) / 190);
  const maxLag = Math.ceil((fps * 60) / 60);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += env[f] * env[f + lag];
    s /= frames - lag;
    // prefer musically common tempi (log-gaussian around 120 bpm)
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    scores.push(s * w);
    if (s * w > best) {
      best = s * w;
      bestLag = lag;
    }
  }
  let onsetStrength = 0;
  for (let f = 0; f < frames; f++) onsetStrength += Math.max(0, env[f]);
  onsetStrength /= frames;
  const bpm = bestLag ? Math.round(((60 * fps) / bestLag) * 10) / 10 : null;
  const loud01 = Math.max(0, Math.min(1, (loudness + 32) / 24));
  const onset01 = Math.max(0, Math.min(1, onsetStrength / (rms * 0.25 + 1e-6)));
  const tempo01 = bpm ? Math.max(0, Math.min(1, (bpm - 60) / 110)) : 0.5;
  const energy = Math.round((loud01 * 0.45 + onset01 * 0.3 + tempo01 * 0.15 + brightness * 0.1) * 1000) / 1000;
  return { bpm, energy, brightness: Math.round(brightness * 1000) / 1000, loudness: Math.round(loudness * 10) / 10 };
}

function decode(input: string, headers: Record<string, string> | undefined, seconds = 40, offset = 15): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-nostdin'];
    if (headers && Object.keys(headers).length && /^https?:/.test(input)) {
      args.push('-headers', Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n');
    }
    args.push('-ss', String(offset), '-t', String(seconds), '-i', input, '-ac', '1', '-ar', '11025', '-f', 'f32le', 'pipe:1');
    const p = spawn(ffmpegBin, args, { env: { ...process.env } });
    const chunks: Buffer[] = [];
    let size = 0;
    p.stdout.on('data', (c: Buffer) => {
      chunks.push(c);
      size += c.length;
    });
    let err = '';
    p.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => p.kill('SIGKILL'), 90_000);
    p.on('error', reject);
    p.on('exit', () => {
      clearTimeout(timer);
      if (!size) return reject(new Error(err.trim().split('\n').pop() || 'ffmpeg produced no audio'));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

function probeDuration(input: string, headers?: Record<string, string>): Promise<number | null> {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0'];
    if (headers && Object.keys(headers).length && /^https?:/.test(input)) args.push('-headers', Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n');
    args.push(input);
    const p = spawn('ffprobe', args);
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.on('error', () => resolve(null));
    const timer = setTimeout(() => p.kill('SIGKILL'), 30_000);
    p.on('exit', () => {
      clearTimeout(timer);
      const d = Number(out.trim());
      resolve(Number.isFinite(d) && d > 0 ? d : null);
    });
  });
}

/** Pick tracks to analyse: all local files; for remote sources only tracks people engage with + a capped sample. */
async function analyseFeatures() {
  if (!(await ffmpegAvailable())) return;
  const { resolveCopy } = await import('./stream');
  const rows = db
    .prepare(
      `SELECT t.id, t.duration FROM tracks t
       WHERE t.features_at IS NULL AND t.kind = 'music'
       ORDER BY
         (EXISTS(SELECT 1 FROM track_copies c JOIN sources s ON s.id = c.source_id WHERE c.track_id = t.id AND s.type IN ('folder','upload'))) DESC,
         (EXISTS(SELECT 1 FROM play_events p WHERE p.track_id = t.id) OR EXISTS(SELECT 1 FROM likes l WHERE l.track_id = t.id) OR EXISTS(SELECT 1 FROM playlist_tracks pt WHERE pt.track_id = t.id)) DESC,
         random()
       LIMIT 400`,
    )
    .all() as { id: string; duration: number | null }[];
  let remoteBudget = 300;
  const work = async (r: { id: string; duration: number | null }) => {
    const target = await resolveCopy(r.id).catch(() => null);
    if (!target) {
      db.prepare('UPDATE tracks SET features_at = ? WHERE id = ?').run(now(), r.id);
      return;
    }
    if (target.kind === 'url') {
      if (remoteBudget-- <= 0) return;
    }
    const input = target.kind === 'file' ? target.path : target.url;
    const headers = target.kind === 'url' ? target.headers : undefined;
    try {
      let duration = r.duration;
      if (!duration) duration = await probeDuration(input, headers);
      const offset = duration && duration > 60 ? Math.min(30, duration * 0.2) : 0;
      const pcm = await decode(input, headers, 40, offset);
      const f = computeFeatures(pcm, 11025);
      db.prepare('UPDATE tracks SET bpm = ?, energy = ?, brightness = ?, loudness = ?, duration = COALESCE(duration, ?), features_at = ? WHERE id = ?').run(
        f.bpm, f.energy, f.brightness, f.loudness, duration, now(), r.id,
      );
    } catch {
      db.prepare('UPDATE tracks SET features_at = ? WHERE id = ?').run(now(), r.id);
    }
  };
  const pool = new Set<Promise<void>>();
  for (const r of rows) {
    const p = work(r).finally(() => pool.delete(p));
    pool.add(p);
    if (pool.size >= 2) await Promise.race(pool);
  }
  await Promise.all(pool);
  if (rows.length === 400) st.again = true;
}
