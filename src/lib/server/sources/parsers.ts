import * as cheerio from 'cheerio';
import type { RawTrack } from './types';
import { AUDIO_EXT, extOf, mimeToFormat, safeDecode } from './media';

/** Resolve a possibly-relative reference against a base URL; returns null for junk. */
export function resolveUrl(ref: string | undefined | null, base: string): string | null {
  if (!ref) return null;
  const r = ref.trim().replace(/&amp;/g, '&');
  if (!r || r.startsWith('#') || /^(javascript|mailto|tel|data|about|blob):/i.test(r)) return null;
  try {
    const u = new URL(r, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function parseDuration(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v > 36000 ? v / 1000 : v; // treat huge numbers as ms
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 36000 ? n / 1000 : n;
  }
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(s);
  if (m) return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/i.exec(s);
  if (iso) return Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
  return undefined;
}

function splitArtistTitle(s: string): { artist?: string; title: string } {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(s.trim());
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: s.trim() };
}

export interface PlaylistParse {
  name?: string;
  entries: RawTrack[];
  /** Entries that themselves are playlists (nested M3U) */
  nested: string[];
}

export function looksLikeM3U(text: string) {
  const t = text.trimStart();
  if (t.startsWith('#EXTM3U')) return true;
  const lines = t.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(0, 20);
  return lines.length > 0 && lines.every((l) => /^(https?:\/\/|\/|\.{0,2}[\w%~.-])/i.test(l.trim()) && !/[<>{}]/.test(l)) && lines.some((l) => !!AUDIO_EXT[extOf(l.trim())] || /^https?:/i.test(l.trim()));
}

export function parseM3U(text: string, base: string): PlaylistParse {
  const entries: RawTrack[] = [];
  const nested: string[] = [];
  let pending: Partial<RawTrack> = {};
  let name: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      let m;
      if ((m = /^#EXTINF:\s*(-?[\d.]+)?\s*(?:[^,]*?)?,(.*)$/i.exec(line))) {
        const dur = Number(m[1]);
        const { artist, title } = splitArtistTitle(m[2] ?? '');
        pending = { ...pending, duration: dur > 0 ? dur : undefined, artist, title: title || undefined };
      } else if ((m = /^#PLAYLIST:\s*(.+)$/i.exec(line))) name = m[1].trim();
      else if ((m = /^#EXTALB:\s*(.+)$/i.exec(line))) pending.album = m[1].trim();
      else if ((m = /^#EXTART:\s*(.+)$/i.exec(line))) pending.albumArtist = m[1].trim();
      else if ((m = /^#EXTGENRE:\s*(.+)$/i.exec(line))) pending.genre = m[1].trim();
      else if ((m = /^#EXTIMG:\s*(.+)$/i.exec(line))) pending.coverUrl = resolveUrl(m[1], base) ?? undefined;
      continue;
    }
    const url = resolveUrl(line, base);
    if (!url) continue;
    const ext = extOf(url);
    if (ext === 'm3u' || ext === 'm3u8' || ext === 'pls') {
      nested.push(url);
    } else {
      entries.push({ ...pending, locator: url, format: AUDIO_EXT[ext] ? ext : undefined, pathHint: safeDecode(new URL(url).pathname), needsTags: true });
    }
    pending = {};
  }
  return { name, entries, nested };
}

export function parsePLS(text: string, base: string): PlaylistParse {
  const files: Record<string, Partial<RawTrack> & { file?: string }> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^(File|Title|Length)(\d+)\s*=\s*(.*)$/i.exec(raw.trim());
    if (!m) continue;
    const e = (files[m[2]] ??= {});
    const k = m[1].toLowerCase();
    if (k === 'file') e.file = m[3].trim();
    else if (k === 'title') Object.assign(e, splitArtistTitle(m[3]));
    else if (k === 'length') {
      const d = Number(m[3]);
      if (d > 0) e.duration = d;
    }
  }
  const entries: RawTrack[] = [];
  for (const key of Object.keys(files).sort((a, b) => Number(a) - Number(b))) {
    const { file, ...meta } = files[key];
    const url = resolveUrl(file, base);
    if (url) entries.push({ ...meta, locator: url, pathHint: safeDecode(new URL(url).pathname), needsTags: true });
  }
  return { entries, nested: [] };
}

export function parseXSPF(text: string, base: string): PlaylistParse {
  const $ = cheerio.load(text, { xml: true });
  const name = $('playlist > title').first().text().trim() || undefined;
  const entries: RawTrack[] = [];
  $('trackList > track').each((_, el) => {
    const t = $(el);
    const url = resolveUrl(t.children('location').first().text(), base);
    if (!url) return;
    const dur = Number(t.children('duration').text());
    entries.push({
      locator: url,
      title: t.children('title').text().trim() || undefined,
      artist: t.children('creator').text().trim() || undefined,
      album: t.children('album').text().trim() || undefined,
      trackNo: Number(t.children('trackNum').text()) || undefined,
      duration: dur > 0 ? dur / 1000 : undefined,
      coverUrl: resolveUrl(t.children('image').text(), base) ?? undefined,
      pathHint: safeDecode(new URL(url).pathname),
      needsTags: true,
    });
  });
  return { name, entries, nested: [] };
}

export function looksLikeFeed(text: string) {
  const head = text.slice(0, 3000);
  return /<rss[\s>]/i.test(head) || /<feed[\s>][^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(head);
}

export function parseFeed(text: string, base: string): { name?: string; author?: string; cover?: string; entries: RawTrack[] } {
  const $ = cheerio.load(text, { xml: true });
  const channel = $('channel').first();
  const isAtom = !channel.length;
  const name = (isAtom ? $('feed > title') : channel.children('title')).first().text().trim() || undefined;
  const author =
    channel.children('itunes\\:author').first().text().trim() || $('feed > author > name').first().text().trim() || undefined;
  const cover =
    resolveUrl(channel.children('itunes\\:image').attr('href'), base) ??
    resolveUrl(channel.children('image').children('url').text(), base) ??
    resolveUrl($('feed > logo, feed > icon').first().text(), base) ??
    undefined;
  const entries: RawTrack[] = [];
  const items = isAtom ? $('entry') : $('item');
  items.each((_, el) => {
    const it = $(el);
    let url: string | null = null;
    let mime: string | undefined;
    let size: number | undefined;
    const enc = it.children('enclosure').filter((_, e) => /audio|mpeg|ogg|mp4|octet/i.test($(e).attr('type') ?? 'audio') || !!AUDIO_EXT[extOf($(e).attr('url') ?? '')]).first();
    if (enc.length) {
      url = resolveUrl(enc.attr('url'), base);
      mime = enc.attr('type');
      size = Number(enc.attr('length')) || undefined;
    }
    if (!url) {
      const mc = it.find('media\\:content').filter((_, e) => /audio/i.test($(e).attr('type') ?? $(e).attr('medium') ?? '')).first();
      if (mc.length) {
        url = resolveUrl(mc.attr('url'), base);
        mime = mc.attr('type');
      }
    }
    if (!url && isAtom) {
      const l = it.children('link[rel="enclosure"]').first();
      url = resolveUrl(l.attr('href'), base);
      mime = l.attr('type');
    }
    if (!url) return;
    const title = it.children('title').first().text().trim();
    const date = Date.parse(it.children('pubDate').text() || it.children('published').text() || it.children('updated').text());
    entries.push({
      locator: url,
      title: title || undefined,
      artist: it.children('itunes\\:author').text().trim() || author || name,
      album: name,
      duration: parseDuration(it.children('itunes\\:duration').text()),
      coverUrl: resolveUrl(it.children('itunes\\:image').attr('href'), base) ?? cover,
      mime: mime ?? null,
      format: mimeToFormat(mime) ?? (AUDIO_EXT[extOf(url)] ? extOf(url) : null),
      size,
      year: Number.isFinite(date) ? new Date(date).getFullYear() : undefined,
      explicit: /yes|true|explicit/i.test(it.children('itunes\\:explicit').text()),
      kind: 'podcast',
      genre: 'Podcast',
    });
  });
  return { name, author, cover, entries };
}

/* ---------------- JSON manifest: generic walker ---------------- */

const URL_KEYS = ['url', 'src', 'file', 'stream', 'stream_url', 'streamUrl', 'audio', 'audio_url', 'audioUrl', 'mp3', 'link', 'location', 'href', 'path', 'download', 'download_url', 'downloadUrl', 'contentUrl', 'source'];
const TITLE_KEYS = ['title', 'name', 'track', 'trackName', 'track_name', 'song', 'songName'];
const ARTIST_KEYS = ['artist', 'artistName', 'artist_name', 'creator', 'author', 'performer', 'by', 'byArtist', 'artists'];
const ALBUM_KEYS = ['album', 'albumName', 'album_name', 'albumTitle', 'release', 'inAlbum'];
const COVER_KEYS = ['cover', 'coverUrl', 'cover_url', 'image', 'imageUrl', 'artwork', 'artworkUrl', 'art', 'thumbnail', 'thumb', 'picture', 'poster'];

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
}
function asText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ') || undefined;
  if (typeof v === 'object') return asText(pick(v as Record<string, unknown>, ['name', 'title', '@value', 'text']));
  return undefined;
}
function asUrl(v: unknown, base: string): string | null {
  if (typeof v === 'string') return resolveUrl(v, base);
  if (v && typeof v === 'object' && !Array.isArray(v)) return asUrl(pick(v as Record<string, unknown>, ['url', 'src', 'href', '@id', 'contentUrl']), base);
  if (Array.isArray(v) && v.length) return asUrl(v[v.length - 1], base);
  return null;
}

interface Ctx {
  artist?: string;
  album?: string;
  cover?: string;
  year?: number;
  genre?: string;
}

export function walkManifest(json: unknown, base: string, limit = 200_000): { name?: string; entries: RawTrack[]; playlists: { name: string; locators: string[] }[] } {
  const entries: RawTrack[] = [];
  const playlists: { name: string; locators: string[] }[] = [];
  const seen = new Set<string>();
  let name: string | undefined;
  if (json && typeof json === 'object' && !Array.isArray(json)) name = asText(pick(json as Record<string, unknown>, ['name', 'title']));

  const visit = (node: unknown, ctx: Ctx, depth: number, collector?: string[]) => {
    if (entries.length >= limit || depth > 12 || node == null) return;
    if (typeof node === 'string') {
      const u = resolveUrl(node, base);
      if (u && (AUDIO_EXT[extOf(u)] || depth > 0)) addTrack({ locator: u }, ctx, collector);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) visit(n, ctx, depth + 1, collector);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const rawUrl = pick(o, URL_KEYS);
    const url = asUrl(rawUrl, base);
    const hasChildren = Object.values(o).some((v) => Array.isArray(v) && v.length && typeof v[0] === 'object');
    const type = asText(o['@type'] ?? o.type ?? o.kind)?.toLowerCase() ?? '';
    const isTrack =
      !!url &&
      (!!AUDIO_EXT[extOf(url)] || /recording|audio|track|song|episode/.test(type) || ['stream', 'stream_url', 'streamUrl', 'audio', 'audio_url', 'audioUrl', 'mp3', 'contentUrl'].some((k) => o[k] != null) || !hasChildren);
    const title = asText(pick(o, TITLE_KEYS));
    if (isTrack && url) {
      addTrack(
        {
          locator: url,
          title,
          artist: asText(pick(o, ARTIST_KEYS)),
          album: asText(pick(o, ALBUM_KEYS)),
          duration: parseDuration(pick(o, ['duration', 'length', 'durationSeconds', 'duration_ms', 'time'])),
          coverUrl: asUrl(pick(o, COVER_KEYS), base) ?? undefined,
          trackNo: Number(pick(o, ['track', 'trackNumber', 'track_number', 'trackNo', 'number', 'position'])) || undefined,
          discNo: Number(pick(o, ['disc', 'discNumber', 'disc_number'])) || undefined,
          year: Number(String(pick(o, ['year', 'releaseYear', 'date', 'datePublished', 'released']) ?? '').slice(0, 4)) || undefined,
          genre: asText(pick(o, ['genre', 'genres', 'tags'])),
          explicit: o.explicit === true || o.explicit === 1,
        },
        ctx,
        collector,
      );
      return;
    }
    // Container: inherit context and recurse
    const next: Ctx = { ...ctx };
    const artist = asText(pick(o, ['artist', 'artistName', 'albumArtist', 'byArtist', 'creator']));
    if (artist) next.artist = artist;
    const albumTitle = asText(pick(o, ALBUM_KEYS)) ?? (/(album|release|record)/.test(type) || 'tracks' in o || 'songs' in o ? title : undefined);
    if (albumTitle) next.album = albumTitle;
    if (!artist && /(artist|band|musicgroup)/.test(type) && title) next.artist = title;
    const cover = asUrl(pick(o, COVER_KEYS), base);
    if (cover) next.cover = cover;
    const y = Number(String(pick(o, ['year', 'releaseYear', 'date', 'datePublished']) ?? '').slice(0, 4));
    if (y > 1800) next.year = y;
    const genre = asText(pick(o, ['genre', 'genres']));
    if (genre) next.genre = genre;
    const isPlaylist = /playlist/.test(type) || ('playlist' in o && false);
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v !== 'object') continue;
      if (k === 'playlists' && Array.isArray(v)) {
        for (const p of v) {
          if (p && typeof p === 'object') {
            const pl: string[] = [];
            visit(p, ctx, depth + 1, pl);
            const pn = asText(pick(p as Record<string, unknown>, ['name', 'title']));
            if (pn && pl.length) playlists.push({ name: pn, locators: pl });
          }
        }
        continue;
      }
      visit(v, next, depth + 1, isPlaylist ? collector : collector);
    }
  };

  const addTrack = (t: RawTrack, ctx: Ctx, collector?: string[]) => {
    if (collector) collector.push(t.locator);
    if (seen.has(t.locator)) return;
    seen.add(t.locator);
    let split: { artist?: string; title: string } | undefined;
    if (t.title && !t.artist && !ctx.artist) split = splitArtistTitle(t.title);
    entries.push({
      ...t,
      title: split?.title ?? t.title,
      artist: t.artist ?? split?.artist ?? ctx.artist,
      albumArtist: ctx.artist,
      album: t.album ?? ctx.album,
      coverUrl: t.coverUrl ?? ctx.cover,
      year: t.year ?? ctx.year,
      genre: t.genre ?? ctx.genre,
      format: AUDIO_EXT[extOf(t.locator)] ? extOf(t.locator) : null,
      pathHint: safeDecode(new URL(t.locator).pathname),
      needsTags: !t.title,
    });
  };

  visit(json, {}, 0);
  return { name, entries, playlists };
}
