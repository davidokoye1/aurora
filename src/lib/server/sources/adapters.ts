import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Adapter, RawTrack, SourceConfig, SyncContext, SourceType } from './types';
import { extractPage, inScope, isCoverName, dirOf, type PageLink } from './html';
import { looksLikeFeed, looksLikeM3U, parseFeed, parseM3U, parsePLS, parseXSPF, walkManifest, resolveUrl, parseDuration } from './parsers';
import { AUDIO_EXT, IMAGE_EXT, extOf, mimeToFormat, safeDecode, sniffAudio, sniffZip } from './media';
import { listZip } from './zip';
import { UPLOAD_DIR } from '../db';
import type { HttpClient } from '../net';

/* ------------------------------------------------------------------ helpers */

export function globToRegex(glob: string): RegExp {
  const esc = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\u0000/g, '.*');
  return new RegExp(glob.includes('/') ? `^${esc}$` : `(^|/)${esc}$`, 'i');
}

export function makeFilter(cfg: SourceConfig) {
  const inc = (cfg.include ?? []).filter(Boolean).map(globToRegex);
  const exc = (cfg.exclude ?? []).filter(Boolean).map(globToRegex);
  return (p: string) => {
    const d = safeDecode(p);
    if (exc.some((r) => r.test(d))) return false;
    if (inc.length && !inc.some((r) => r.test(d))) return false;
    return true;
  };
}

let playwrightBrowser: Promise<unknown> | null = null;
/** Render a page with headless Chromium for sites that build their link list with JavaScript. */
export async function renderWithBrowser(url: string, cfg: SourceConfig): Promise<string> {
  type PW = { chromium: { launch: (o?: unknown) => Promise<unknown> } };
  let pw: PW | null = null;
  const { createRequire: cr } = (await import(/* webpackIgnore: true */ 'node:module')) as unknown as { createRequire: (p: string) => (id: string) => unknown };
  const bases = [process.cwd(), ...(process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean).map((d) => path.dirname(d)), ...(process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean)];
  for (const b of bases) {
    try {
      const req = cr(path.join(b, 'noop.js'));
      pw = req(fs.existsSync(path.join(b, 'playwright')) ? path.join(b, 'playwright') : 'playwright') as PW;
      break;
    } catch {}
  }
  if (!pw) throw new Error('JavaScript rendering needs Playwright on the server (npm i playwright && npx playwright install chromium).');
  playwrightBrowser ??= pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const browser = (await playwrightBrowser) as {
    newContext: (o: unknown) => Promise<{
      newPage: () => Promise<{ goto: (u: string, o: unknown) => Promise<unknown>; waitForTimeout: (n: number) => Promise<void>; content: () => Promise<string> }>;
      close: () => Promise<void>;
    }>;
  };
  const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
  if (cfg.username) headers.authorization = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64');
  delete headers['user-agent'];
  const ctx = await browser.newContext({ extraHTTPHeaders: headers, userAgent: cfg.headers?.['user-agent'] });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(800);
    return await page.content();
  } finally {
    await ctx.close();
  }
}

interface Classified {
  kind: 'audio' | 'html' | 'm3u' | 'pls' | 'xspf' | 'feed' | 'json' | 'zip' | 'image' | 'other';
  format?: string | null;
  mime?: string | null;
  size?: number;
}

/** Probe an opaque URL with a tiny ranged GET and classify by headers + magic bytes. */
export async function probe(client: HttpClient, url: string): Promise<Classified & { finalUrl: string; status: number }> {
  const h = await client.head(url, 512);
  const ct = (h.headers.get('content-type') ?? '').toLowerCase();
  const disp = h.headers.get('content-disposition') ?? '';
  const dispName = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disp)?.[1];
  const sniff = sniffAudio(h.bytes);
  const base = { finalUrl: h.url, status: h.status, size: h.total ?? undefined };
  if (h.status >= 400) return { ...base, kind: 'other' };
  if (sniff) return { ...base, kind: 'audio', format: sniff.format, mime: sniff.mime };
  if (sniffZip(h.bytes) || /zip/.test(ct)) return { ...base, kind: 'zip' };
  const head = new TextDecoder().decode(h.bytes);
  if (/mpegurl/.test(ct) || head.trimStart().startsWith('#EXTM3U')) return { ...base, kind: 'm3u' };
  if (/scpls/.test(ct) || /^\s*\[playlist\]/i.test(head)) return { ...base, kind: 'pls' };
  if (/xspf/.test(ct)) return { ...base, kind: 'xspf' };
  if (ct.startsWith('audio/') || (dispName && AUDIO_EXT[extOf(dispName)])) {
    const fmt = mimeToFormat(ct) ?? (dispName ? extOf(dispName) : null);
    return { ...base, kind: 'audio', format: fmt, mime: ct || null };
  }
  const text = new TextDecoder().decode(h.bytes);
  if (/mpegurl/.test(ct) || text.trimStart().startsWith('#EXTM3U')) return { ...base, kind: 'm3u' };
  if (/scpls/.test(ct) || /^\s*\[playlist\]/i.test(text)) return { ...base, kind: 'pls' };
  if (/xspf/.test(ct) || /<playlist[^>]+xspf/i.test(text)) return { ...base, kind: 'xspf' };
  if (/rss|atom/.test(ct) || looksLikeFeed(text)) return { ...base, kind: 'feed' };
  if (/json/.test(ct) || /^\s*[[{]/.test(text)) return { ...base, kind: 'json' };
  if (/html|xml/.test(ct) || /<(html|!doctype|head|body)/i.test(text)) return { ...base, kind: 'html' };
  if (ct.startsWith('image/')) return { ...base, kind: 'image' };
  if (/octet-stream/.test(ct) && h.bytes.length < 16) return { ...base, kind: 'other' };
  if (looksLikeM3U(text)) return { ...base, kind: 'm3u' };
  return { ...base, kind: 'other' };
}

/* ------------------------------------------------------------- HTTP crawler */

async function* playlistEntries(ctx: SyncContext, url: string, kind: 'm3u' | 'pls' | 'xspf', depth = 0): AsyncGenerator<RawTrack> {
  const { text, url: finalUrl } = await ctx.client.text(url);
  ctx.page();
  const parsed = kind === 'pls' ? parsePLS(text, finalUrl) : kind === 'xspf' ? parseXSPF(text, finalUrl) : parseM3U(text, finalUrl);
  const name = parsed.name ?? safeDecode(new URL(finalUrl).pathname.split('/').pop() ?? 'Playlist').replace(/\.[a-z0-9]+$/i, '');
  if (parsed.entries.length && ctx.playlist) ctx.playlist(name, parsed.entries.map((e) => e.locator));
  for (const e of parsed.entries) yield e;
  if (depth < 3) for (const n of parsed.nested) yield* playlistEntries(ctx, n, extOf(n) === 'pls' ? 'pls' : 'm3u', depth + 1);
}

async function* zipEntries(ctx: SyncContext, url: string, cover?: string): AsyncGenerator<RawTrack> {
  try {
    const entries = await listZip(ctx.client, url);
    const zipName = safeDecode(new URL(url).pathname).replace(/\.zip$/i, '');
    for (const e of entries) {
      yield {
        locator: `zip:${url}#${e.name}`,
        pathHint: `${zipName}/${e.name}`,
        format: extOf(e.name),
        size: e.size,
        coverUrl: cover,
        needsTags: false,
      };
    }
  } catch (e) {
    ctx.log(`Archive ${url}: ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------- Internet Archive items */

export function archiveItemId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)archive\.org$/.test(u.hostname)) return null;
    const m = /^\/(?:details|download|embed)\/([^/?#]+)/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

interface IAFile {
  name: string; format?: string; title?: string; creator?: string; artist?: string; album?: string; track?: string; length?: string; size?: string; source?: string; original?: string; genre?: string;
}

export async function archiveItem(client: HttpClient, id: string) {
  const meta = await client.json<{ metadata?: Record<string, string | string[]>; files?: IAFile[]; is_dark?: boolean }>(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!meta.files) throw new Error('Internet Archive item not found or not public.');
  const md = meta.metadata ?? {};
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
  const base = `https://archive.org/download/${encodeURIComponent(id)}/`;
  const byName = new Map(meta.files.map((f) => [f.name, f]));
  const images = meta.files.filter((f) => /jpe?g|png/i.test(f.format ?? '') && !/thumb/i.test(f.name));
  const cover = images.find((f) => /cover|front|folder/i.test(f.name)) ?? images.find((f) => f.source === 'original') ?? images[0];
  const year = Number(String(one(md.date) ?? one(md.year) ?? '').slice(0, 4)) || undefined;
  const tracks: RawTrack[] = [];
  for (const f of meta.files) {
    const ext = extOf(f.name);
    if (!AUDIO_EXT[ext] || /\/?(__ia_thumb|_spectrogram)/i.test(f.name)) continue;
    // derivatives inherit metadata from their original
    const orig = f.source === 'derivative' && f.original ? byName.get(f.original) : undefined;
    const pick = <K extends keyof IAFile>(k: K) => f[k] ?? orig?.[k];
    const len = pick('length');
    tracks.push({
      locator: base + f.name.split('/').map(encodeURIComponent).join('/'),
      title: pick('title') || undefined,
      artist: pick('creator') || pick('artist') || one(md.creator),
      album: pick('album') || one(md.title),
      albumArtist: one(md.creator),
      trackNo: Number(String(pick('track') ?? '').split('/')[0]) || undefined,
      year,
      genre: pick('genre') || undefined,
      duration: len ? parseDuration(len) : undefined,
      size: Number(f.size) || undefined,
      format: ext,
      mime: AUDIO_EXT[ext].mime,
      bitrate: /64kb/i.test(f.name) ? 64 : /vbr/i.test(f.format ?? '') ? 192 : undefined,
      pathHint: `${one(md.title) ?? id}/${(orig?.name ?? f.name)}`,
      coverUrl: cover ? base + cover.name.split('/').map(encodeURIComponent).join('/') : `https://archive.org/services/img/${encodeURIComponent(id)}`,
      needsTags: !pick('title'),
    });
  }
  return { title: one(md.title) ?? id, creator: one(md.creator), tracks };
}

const httpAdapter: Adapter = {
  type: 'http',
  async *sync(ctx) {
    const cfg = ctx.config;
    const start = cfg.url!;
    const ia = archiveItemId(start);
    if (ia) {
      const item = await archiveItem(ctx.client, ia);
      ctx.page();
      ctx.log(`Internet Archive item “${item.title}”: ${item.tracks.length} audio files.`);
      const filter = makeFilter(cfg);
      for (const t of item.tracks) if (filter(new URL(t.locator).pathname)) yield t;
      return;
    }
    const scopeRoot = new URL(start);
    const maxDepth = cfg.maxDepth ?? 10;
    const maxPages = cfg.maxPages ?? 5000;
    const maxFiles = cfg.maxFiles ?? 50_000;
    const filter = makeFilter(cfg);
    const visited = new Set<string>();
    const yielded = new Set<string>();
    const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
    let pages = 0;
    let files = 0;
    const startDir = dirOf(start);

    const relPath = (u: string) => {
      const p = safeDecode(new URL(u).pathname);
      const root = safeDecode(new URL(startDir).pathname);
      return p.startsWith(root) ? p.slice(root.length) : p;
    };

    while (queue.length && !ctx.signal.aborted) {
      if (pages >= maxPages) {
        ctx.log(`Stopped after ${maxPages} pages (limit).`);
        break;
      }
      if (files >= maxFiles) {
        ctx.log(`Stopped after ${maxFiles} files (limit).`);
        break;
      }
      const { url, depth } = queue.shift()!;
      const key = url.replace(/\/+$/, '/');
      if (visited.has(key)) continue;
      visited.add(key);

      let res;
      try {
        res = await ctx.client.text(url);
      } catch (e) {
        ctx.log(`Failed ${url}: ${(e as Error).message}`);
        continue;
      }
      pages++;
      ctx.page();
      if (res.status === 401 || res.status === 403) {
        ctx.log(`HTTP ${res.status} at ${url} — this page needs credentials, a cookie or a Referer header (edit the source's access settings).`);
        continue;
      }
      if (res.status >= 400) {
        ctx.log(`HTTP ${res.status} at ${url}`);
        continue;
      }
      visited.add(res.url.replace(/\/+$/, '/'));
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      const sniff = sniffAudio(res.bytes);
      // The start URL itself might be a direct file / playlist / feed.
      if (sniff || ct.startsWith('audio/')) {
        if (!yielded.has(res.url)) {
          yielded.add(res.url);
          files++;
          yield { locator: res.url, format: sniff?.format ?? mimeToFormat(ct), mime: sniff?.mime ?? ct, pathHint: relPath(res.url), needsTags: true };
        }
        continue;
      }
      if (sniffZip(res.bytes)) {
        yield* zipEntries(ctx, res.url);
        continue;
      }
      if (/mpegurl/.test(ct) || res.text.trimStart().startsWith('#EXTM3U')) {
        yield* playlistEntries(ctx, res.url, 'm3u');
        continue;
      }
      if (/^\s*\[playlist\]/i.test(res.text)) {
        yield* playlistEntries(ctx, res.url, 'pls');
        continue;
      }
      if (looksLikeFeed(res.text)) {
        for (const e of parseFeed(res.text, res.url).entries) yield e;
        continue;
      }
      if (/json/.test(ct) || /^\s*[[{]/.test(res.text)) {
        try {
          for (const e of walkManifest(JSON.parse(res.text), res.url).entries) yield e;
        } catch {}
        continue;
      }

      let html = res.text;
      let info = extractPage(html, res.url);
      if (cfg.renderJs && (info.scriptHeavy || info.links.filter((l) => l.kind !== 'skip').length < 5)) {
        try {
          html = await renderWithBrowser(res.url, cfg);
          info = extractPage(html, res.url);
          ctx.log(`Rendered ${res.url} with JavaScript (${info.links.length} links).`);
        } catch (e) {
          ctx.log((e as Error).message);
        }
      } else if (info.scriptHeavy && depth === 0) {
        ctx.log('This page appears to build its content with JavaScript. If few tracks are found, enable "Render JavaScript" for this source.');
      }

      // Cover art for this page/folder
      const images = info.links.filter((l) => l.kind === 'image');
      const cover = images.find((l) => isCoverName(l.url))?.url ?? (info.isIndex && images.length > 0 && images.length <= 3 ? images[0].url : undefined) ?? (!info.isIndex ? info.ogImage : undefined);

      const pageTracks: RawTrack[] = [];
      const probes: PageLink[] = [];
      for (const l of info.links) {
        if (!filter(new URL(l.url).pathname) && l.kind !== 'page') continue;
        switch (l.kind) {
          case 'audio': {
            if (yielded.has(l.url)) break;
            yielded.add(l.url);
            const meta = info.ld.get(l.url);
            const ext = extOf(l.url);
            pageTracks.push({
              locator: l.url,
              format: AUDIO_EXT[ext] ? ext : null,
              mime: AUDIO_EXT[ext]?.mime ?? null,
              pathHint: relPath(l.url),
              textHint: l.text,
              title: meta?.title,
              artist: meta?.artist,
              album: meta?.album,
              duration: parseDuration(meta?.duration),
              coverUrl: cover && dirOf(cover) === dirOf(l.url) ? cover : cover && !info.isIndex ? cover : undefined,
              needsTags: true,
            });
            break;
          }
          case 'playlist':
            if (!yielded.has(l.url)) {
              yielded.add(l.url);
              try {
                for await (const e of playlistEntries(ctx, l.url, extOf(l.url) === 'pls' ? 'pls' : extOf(l.url) === 'xspf' ? 'xspf' : 'm3u')) {
                  if (!yielded.has(e.locator)) {
                    yielded.add(e.locator);
                    files++;
                    yield e;
                  }
                }
              } catch (e) {
                ctx.log(`Playlist ${l.url}: ${(e as Error).message}`);
              }
            }
            break;
          case 'archive':
            // Archives on pages that already list loose audio files are usually bundles of the same files.
            if (!yielded.has(l.url) && !info.links.some((x) => x.kind === 'audio')) {
              yielded.add(l.url);
              for await (const e of zipEntries(ctx, l.url, cover)) {
                files++;
                yield e;
              }
            }
            break;
          case 'page':
            if (depth < maxDepth && (inScope(l.url, res.url, scopeRoot, !!cfg.wideScope) || (l.next && new URL(l.url).host === scopeRoot.host))) {
              const k = l.url.replace(/\/+$/, '/');
              if (!visited.has(k)) {
                if (l.next) queue.unshift({ url: l.url, depth });
                else queue.push({ url: l.url, depth: depth + 1 });
              }
            }
            break;
          case 'probe':
            if (!yielded.has(l.url)) probes.push(l);
            break;
        }
      }

      // Probe opaque links (download?id=…) a few at a time
      const sameHostProbes = probes.slice(0, 500);
      for (let i = 0; i < sameHostProbes.length && !ctx.signal.aborted; i += 4) {
        const batch = sameHostProbes.slice(i, i + 4);
        const results = await Promise.all(batch.map((l) => probe(ctx.client, l.url).then((r) => ({ l, r })).catch(() => null)));
        for (const item of results) {
          if (!item) continue;
          const { l, r } = item;
          if (r.kind === 'audio') {
            yielded.add(l.url);
            const textName = l.text && AUDIO_EXT[extOf(l.text.replace(/\s+/g, '_'))] ? l.text : undefined;
            pageTracks.push({
              locator: l.url,
              format: r.format,
              mime: r.mime,
              size: r.size,
              pathHint: textName ? relPath(dirOf(res.url)) + textName : relPath(r.finalUrl),
              textHint: l.text,
              coverUrl: cover,
              needsTags: true,
            });
          } else if (r.kind === 'html' && depth < maxDepth && inScope(r.finalUrl, res.url, scopeRoot, !!cfg.wideScope)) {
            queue.push({ url: r.finalUrl, depth: depth + 1 });
          } else if (r.kind === 'm3u' || r.kind === 'pls' || r.kind === 'xspf') {
            for await (const e of playlistEntries(ctx, r.finalUrl, r.kind)) yield e;
          } else if (r.kind === 'zip') {
            for await (const e of zipEntries(ctx, r.finalUrl, cover)) yield e;
          }
        }
      }

      for (const t of pageTracks) {
        if (files >= maxFiles) break;
        files++;
        yield t;
      }
    }
  },
  resolve(locator) {
    if (locator.startsWith('zip:')) {
      const i = locator.lastIndexOf('#');
      return { kind: 'zip', zipUrl: locator.slice(4, i), entry: locator.slice(i + 1) };
    }
    return { kind: 'url', url: locator };
  },
};

/* ------------------------------------------------------------ playlist file */

const playlistAdapter: Adapter = {
  type: 'playlist',
  async *sync(ctx) {
    const url = ctx.config.url!;
    const p = await probe(ctx.client, url);
    const kind = p.kind === 'pls' ? 'pls' : p.kind === 'xspf' ? 'xspf' : extOf(url) === 'pls' ? 'pls' : extOf(url) === 'xspf' ? 'xspf' : 'm3u';
    yield* playlistEntries(ctx, p.finalUrl, kind);
  },
  resolve: (l) => ({ kind: 'url', url: l }),
};

/* ------------------------------------------------------------ JSON manifest */

const manifestAdapter: Adapter = {
  type: 'manifest',
  async *sync(ctx) {
    const { text, url } = await ctx.client.text(ctx.config.url!, 256 * 1024 * 1024);
    ctx.page();
    const parsed = walkManifest(JSON.parse(text), url);
    for (const p of parsed.playlists) ctx.playlist?.(p.name, p.locators);
    for (const e of parsed.entries) yield e;
  },
  resolve: (l) => ({ kind: 'url', url: l }),
};

/* ------------------------------------------------------------ RSS / podcasts */

const rssAdapter: Adapter = {
  type: 'rss',
  async *sync(ctx) {
    const { text, url } = await ctx.client.text(ctx.config.url!, 64 * 1024 * 1024);
    ctx.page();
    for (const e of parseFeed(text, url).entries) yield e;
  },
  resolve: (l) => ({ kind: 'url', url: l }),
};

/* ------------------------------------------------------------ Subsonic */

export function subsonicAuth(cfg: SourceConfig, legacy = false) {
  const p = new URLSearchParams({ u: cfg.username ?? '', v: '1.16.1', c: 'aurora', f: 'json' });
  if (legacy) p.set('p', 'enc:' + Buffer.from(cfg.password ?? '').toString('hex'));
  else {
    const salt = crypto.randomBytes(6).toString('hex');
    p.set('t', crypto.createHash('md5').update((cfg.password ?? '') + salt).digest('hex'));
    p.set('s', salt);
  }
  return p;
}
export function subsonicBase(url: string) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  let p = u.pathname.replace(/\/+$/, '');
  p = p.replace(/\/rest(\/.*)?$/, '');
  p = p.replace(/\/(app|index\.html|#.*)$/, '');
  return `${u.origin}${p}`;
}

interface SubsonicResp {
  'subsonic-response': { status: 'ok' | 'failed'; error?: { code: number; message: string }; [k: string]: unknown };
}

export async function subsonicCall<T = Record<string, unknown>>(client: HttpClient, cfg: SourceConfig, method: string, params: Record<string, string> = {}): Promise<T> {
  const call = async (legacy: boolean) => {
    const q = subsonicAuth(cfg, legacy);
    for (const [k, v] of Object.entries(params)) q.set(k, v);
    const r = await client.json<SubsonicResp>(`${subsonicBase(cfg.url!)}/rest/${method}?${q}`);
    return r['subsonic-response'];
  };
  let r = await call(false);
  if (r.status === 'failed' && (r.error?.code === 41 || r.error?.code === 42)) r = await call(true);
  if (r.status === 'failed') throw new Error(`Subsonic: ${r.error?.message ?? 'request failed'} (code ${r.error?.code})`);
  return r as T;
}

interface SubSong {
  id: string; title?: string; album?: string; artist?: string; track?: number; discNumber?: number; year?: number; genre?: string;
  duration?: number; bitRate?: number; suffix?: string; contentType?: string; size?: number; coverArt?: string; isVideo?: boolean; albumArtists?: { name: string }[]; displayAlbumArtist?: string;
}

const subsonicAdapter: Adapter = {
  type: 'subsonic',
  async *sync(ctx) {
    const cfg = ctx.config;
    await subsonicCall(ctx.client, cfg, 'ping');
    let offset = 0;
    const size = 500;
    for (;;) {
      if (ctx.signal.aborted) return;
      const r = await subsonicCall<{ albumList2?: { album?: { id: string }[] } }>(ctx.client, cfg, 'getAlbumList2', { type: 'alphabeticalByName', size: String(size), offset: String(offset) });
      const albums = r.albumList2?.album ?? [];
      ctx.page();
      for (const a of albums) {
        if (ctx.signal.aborted) return;
        try {
          const ar = await subsonicCall<{ album?: { song?: SubSong[]; artist?: string; coverArt?: string; year?: number; genre?: string; name?: string } }>(ctx.client, cfg, 'getAlbum', { id: a.id });
          const al = ar.album;
          for (const s of al?.song ?? []) {
            if (s.isVideo) continue;
            const coverId = s.coverArt ?? al?.coverArt;
            yield {
              locator: `subsonic:${s.id}`,
              title: s.title, artist: s.artist, album: s.album ?? al?.name, albumArtist: s.displayAlbumArtist ?? s.albumArtists?.[0]?.name ?? al?.artist,
              trackNo: s.track, discNo: s.discNumber, year: s.year ?? al?.year, genre: s.genre ?? al?.genre, duration: s.duration, bitrate: s.bitRate,
              format: s.suffix ?? mimeToFormat(s.contentType), mime: s.contentType ?? null, size: s.size,
              coverUrl: coverId ? `subsonic-art:${coverId}` : undefined,
            };
          }
        } catch (e) {
          ctx.log(`Album ${a.id}: ${(e as Error).message}`);
        }
      }
      if (albums.length < size) break;
      offset += size;
    }
    // Playlists
    try {
      const pl = await subsonicCall<{ playlists?: { playlist?: { id: string; name: string }[] } }>(ctx.client, cfg, 'getPlaylists');
      for (const p of pl.playlists?.playlist ?? []) {
        const d = await subsonicCall<{ playlist?: { entry?: { id: string }[] } }>(ctx.client, cfg, 'getPlaylist', { id: p.id });
        const locs = (d.playlist?.entry ?? []).map((e) => `subsonic:${e.id}`);
        if (locs.length) ctx.playlist?.(p.name, locs);
      }
    } catch {}
  },
  resolve(locator, cfg) {
    const id = locator.replace(/^subsonic:/, '');
    const q = subsonicAuth(cfg, false);
    q.set('id', id);
    q.set('format', 'raw');
    q.delete('f');
    return { kind: 'url', url: `${subsonicBase(cfg.url!)}/rest/stream?${q}` };
  },
};

export function subsonicArtUrl(cfg: SourceConfig, id: string) {
  const q = subsonicAuth(cfg, false);
  q.set('id', id);
  q.set('size', '600');
  q.delete('f');
  return `${subsonicBase(cfg.url!)}/rest/getCoverArt?${q}`;
}

/* ------------------------------------------------------------ Jellyfin / Emby */

export function jellyfinBase(url: string) {
  const u = new URL(url);
  let p = u.pathname.replace(/\/+$/, '');
  p = p.replace(/\/(web(\/.*)?|index\.html)$/, '');
  return `${u.origin}${p}`;
}
const JF_AUTH = 'MediaBrowser Client="Aurora", Device="Aurora Server", DeviceId="aurora-server", Version="1.0.0"';

export async function jellyfinToken(client: HttpClient, cfg: SourceConfig): Promise<{ token: string; userId?: string }> {
  if (cfg.apiKey) return { token: cfg.apiKey };
  const r = await client.request(`${jellyfinBase(cfg.url!)}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-emby-authorization': JF_AUTH, authorization: JF_AUTH },
    body: JSON.stringify({ Username: cfg.username, Pw: cfg.password ?? '' }),
    noRetry: true,
  });
  if (r.status >= 400) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`Jellyfin login failed (HTTP ${r.status})`);
  }
  const j = (await r.res.json()) as { AccessToken: string; User?: { Id: string } };
  return { token: j.AccessToken, userId: j.User?.Id };
}

interface JfItem {
  Id: string; Name?: string; Album?: string; AlbumArtist?: string; Artists?: string[]; IndexNumber?: number; ParentIndexNumber?: number;
  ProductionYear?: number; Genres?: string[]; RunTimeTicks?: number; AlbumId?: string; Container?: string; MediaSources?: { Size?: number; Bitrate?: number; Container?: string }[];
  ImageTags?: { Primary?: string }; AlbumPrimaryImageTag?: string;
}

const jellyfinAdapter: Adapter = {
  type: 'jellyfin',
  async *sync(ctx) {
    const cfg = ctx.config;
    const { token, userId } = await jellyfinToken(ctx.client, cfg);
    (cfg as SourceConfig & { _token?: string })._token = token;
    const base = jellyfinBase(cfg.url!);
    const headers = { 'x-emby-token': token, 'x-mediabrowser-token': token };
    let start = 0;
    const limit = 500;
    for (;;) {
      if (ctx.signal.aborted) return;
      const path = userId ? `/Users/${userId}/Items` : '/Items';
      const r = await ctx.client.json<{ Items: JfItem[]; TotalRecordCount: number }>(
        `${base}${path}?IncludeItemTypes=Audio&Recursive=true&Fields=Genres,ProductionYear,MediaSources,ParentId&SortBy=AlbumArtist,Album,ParentIndexNumber,IndexNumber&StartIndex=${start}&Limit=${limit}`,
        headers,
      );
      ctx.page();
      for (const it of r.Items) {
        const ms = it.MediaSources?.[0];
        const art = it.AlbumId && it.AlbumPrimaryImageTag ? it.AlbumId : it.ImageTags?.Primary ? it.Id : undefined;
        yield {
          locator: `jellyfin:${it.Id}`,
          title: it.Name, album: it.Album, albumArtist: it.AlbumArtist, artist: it.Artists?.join(', ') || it.AlbumArtist,
          trackNo: it.IndexNumber, discNo: it.ParentIndexNumber, year: it.ProductionYear, genre: it.Genres?.[0],
          duration: it.RunTimeTicks ? it.RunTimeTicks / 1e7 : undefined, format: (ms?.Container ?? it.Container)?.split(',')[0], size: ms?.Size, bitrate: ms?.Bitrate ? Math.round(ms.Bitrate / 1000) : undefined,
          coverUrl: art ? `jellyfin-art:${art}` : undefined,
        };
      }
      start += r.Items.length;
      if (!r.Items.length || start >= r.TotalRecordCount) break;
    }
  },
  resolve(locator, cfg) {
    const id = locator.replace(/^jellyfin:/, '');
    const token = cfg.apiKey ?? (cfg as SourceConfig & { _token?: string })._token ?? '';
    return { kind: 'url', url: `${jellyfinBase(cfg.url!)}/Audio/${id}/stream?static=true&api_key=${encodeURIComponent(token)}` };
  },
};

/* ------------------------------------------------------------ Local folders */

/** Errors that mean "skip this folder" rather than "the walk is incomplete". */
const SKIPPABLE = new Set(['EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG']);

export class DriveMissingError extends Error {
  constructor(public root: string) {
    super(`Drive or folder not connected: ${root}`);
  }
}

/**
 * Walk a folder tree yielding audio files with their size and modified time. A folder that vanishes or fails
 * mid-walk (an unplugged drive) throws, so the caller never prunes songs on a partial scan.
 */
export async function* walkDir(dir: string, root: string, filter: (p: string) => boolean, signal: AbortSignal): AsyncGenerator<{ file: string; rel: string; cover?: string; size: number; mtime: number }> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    if (SKIPPABLE.has(code) && dir !== root) return;
    if (!fs.existsSync(root)) throw new DriveMissingError(root);
    throw e;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const images = entries.filter((e) => e.isFile() && IMAGE_EXT.has(extOf(e.name)));
  const coverEntry = images.find((e) => /^(cover|folder|front|album)/i.test(e.name)) ?? (images.length <= 2 ? images[0] : undefined);
  const cover = coverEntry ? path.join(dir, coverEntry.name) : undefined;
  for (const e of entries) {
    if (signal.aborted) return;
    if (e.name.startsWith('.') || e.name.startsWith('$') || e.name === 'System Volume Information') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (e.isDirectory()) yield* walkDir(full, root, filter, signal);
    else if (e.isFile() && AUDIO_EXT[extOf(e.name)] && filter(rel)) {
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(full);
      } catch (err) {
        if (!fs.existsSync(root)) throw new DriveMissingError(root);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // deleted while scanning
        throw err;
      }
      yield { file: full, rel, cover, size: st.size, mtime: Math.floor(st.mtimeMs) };
    }
  }
}

const folderAdapter: Adapter = {
  type: 'folder',
  async *sync(ctx) {
    const root = path.resolve(ctx.config.path!);
    if (!fs.existsSync(root)) throw new DriveMissingError(root);
    const filter = makeFilter(ctx.config);
    for await (const f of walkDir(root, root, filter, ctx.signal)) {
      yield { locator: f.file, pathHint: f.rel, format: extOf(f.file), needsTags: true, size: f.size, mtime: f.mtime, coverUrl: f.cover ? `file:${f.cover}` : undefined };
    }
  },
  resolve: (l) => ({ kind: 'file', path: l }),
};

const uploadAdapter: Adapter = {
  type: 'upload',
  async *sync(ctx) {
    for await (const f of walkDir(UPLOAD_DIR, UPLOAD_DIR, () => true, ctx.signal)) {
      yield { locator: path.relative(UPLOAD_DIR, f.file), pathHint: f.rel, format: extOf(f.file), needsTags: true, size: f.size, mtime: f.mtime };
    }
  },
  resolve: (l) => ({ kind: 'file', path: path.join(UPLOAD_DIR, path.normalize(l).replace(/^(\.\.[/\\])+/, '')) }),
};

export const ADAPTERS: Record<SourceType, Adapter> = {
  http: httpAdapter,
  playlist: playlistAdapter,
  manifest: manifestAdapter,
  rss: rssAdapter,
  subsonic: subsonicAdapter,
  jellyfin: jellyfinAdapter,
  folder: folderAdapter,
  upload: uploadAdapter,
};

export { resolveUrl };
