import 'server-only';
import type { IAudioMetadata } from 'music-metadata';
import { AbstractTokenizer, EndOfStreamError, type IReadChunkOptions } from 'strtok3';
import type { HttpClient } from './net';
import type { RawTrack } from './sources/types';
import { sniffAudio } from './sources/media';

type MM = typeof import('music-metadata');
let mmP: Promise<MM> | null = null;
const mm = () => (mmP ??= import('music-metadata'));

/** Placeholder values some encoders write into tags; treat them as missing. */
const JUNK = /^(tmp|temp|test|track\s*\d*|audio\s*(track)?\s*\d*|untitled|unknown|no\s*title|title|artist|album|various|n\/?a|none|null|-+|\?+|\d+|new recording.*|recording\s*\d*)$/i;
const clean = (v?: string | null) => {
  const t = v?.replace(/\0/g, '').trim();
  return t && !JUNK.test(t) ? t : undefined;
};

function fromMeta(m: IAudioMetadata, base: RawTrack): RawTrack {
  const c0 = m.common;
  const c = { ...c0, title: clean(c0.title), artist: clean(c0.artist), artists: c0.artists?.map((a) => clean(a)).filter(Boolean) as string[] | undefined, album: clean(c0.album), albumartist: clean(c0.albumartist) };
  const pic = c.picture?.[0];
  const explicit = (c as unknown as { itunesAdvisory?: string }).itunesAdvisory === '1' || /explicit/i.test(c.comment?.map((x) => (typeof x === 'string' ? x : x.text)).join(' ') ?? '');
  return {
    ...base,
    title: c.title?.trim() || base.title,
    artist: (c.artists?.join(', ') || c.artist)?.trim() || base.artist,
    albumArtist: c.albumartist?.trim() || base.albumArtist,
    album: c.album?.trim() || base.album,
    trackNo: c.track?.no ?? base.trackNo,
    discNo: c.disk?.no ?? base.discNo,
    year: c.year ?? (c.date ? Number(String(c.date).slice(0, 4)) || undefined : undefined) ?? base.year,
    genre: c.genre?.[0]?.trim() || base.genre,
    duration: m.format.duration ?? base.duration,
    bitrate: m.format.bitrate ? Math.round(m.format.bitrate / 1000) : base.bitrate,
    format: base.format ?? (m.format.container ? m.format.container.toLowerCase().replace('mpeg', 'mp3') : null),
    coverData: pic ? { data: pic.data, mime: pic.format } : base.coverData,
    explicit: base.explicit || explicit,
    replaygain: m.format.trackGain ?? c.replaygain_track_gain?.dB ?? base.replaygain,
  };
}

export async function readLocalTags(file: string, base: RawTrack): Promise<RawTrack> {
  const { parseFile } = await mm();
  const m = await parseFile(file, { duration: true, skipCovers: false });
  return fromMeta(m, base);
}

/**
 * Random-access tokenizer over HTTP Range requests with a small block cache, so music-metadata can
 * jump straight to an MP4 "moov" atom at the end of a file, skip "mdat", etc. without downloading it.
 */
class RangeTokenizer extends AbstractTokenizer {
  fileInfo: { size: number; mimeType?: string; url: string };
  private blocks = new Map<number, Uint8Array>();
  private requests = 0;
  private static BLOCK = 128 * 1024;
  constructor(private client: HttpClient, url: string, size: number, mimeType: string | undefined, first: Uint8Array) {
    super();
    this.fileInfo = { size, mimeType, url };
    for (let i = 0; i * RangeTokenizer.BLOCK < first.length; i++) {
      const b = first.subarray(i * RangeTokenizer.BLOCK, (i + 1) * RangeTokenizer.BLOCK);
      if (b.length === RangeTokenizer.BLOCK || (i + 1) * RangeTokenizer.BLOCK >= size) this.blocks.set(i, b);
    }
  }
  supportsRandomAccess() {
    return true;
  }
  setPosition(position: number) {
    this.position = position;
  }
  private async block(i: number): Promise<Uint8Array> {
    const c = this.blocks.get(i);
    if (c) return c;
    if (++this.requests > 24) throw new Error('Too many range reads for tag parsing');
    const start = i * RangeTokenizer.BLOCK;
    const end = Math.min(this.fileInfo.size, start + RangeTokenizer.BLOCK) - 1;
    const r = await this.client.request(this.fileInfo.url, { headers: { range: `bytes=${start}-${end}` } });
    if (r.status !== 206) {
      await r.body?.cancel().catch(() => {});
      throw new Error('Range not supported');
    }
    const { readLimited } = await import('./net');
    const b = await readLimited(r.body, end - start + 1);
    this.blocks.set(i, b);
    return b;
  }
  async peekBuffer(target: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    const o = this.normalizeOptions(target, options);
    const size = this.fileInfo.size;
    const len = Math.max(0, Math.min(o.length, size - o.position));
    if (!o.mayBeLess && len < o.length) throw new EndOfStreamError();
    let copied = 0;
    while (copied < len) {
      const pos = o.position + copied;
      const bi = Math.floor(pos / RangeTokenizer.BLOCK);
      const b = await this.block(bi);
      const off = pos - bi * RangeTokenizer.BLOCK;
      const n = Math.min(len - copied, b.length - off);
      if (n <= 0) break;
      target.set(b.subarray(off, off + n), copied);
      copied += n;
    }
    return copied;
  }
  async readBuffer(target: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    const o = this.normalizeOptions(target, options);
    const n = await this.peekBuffer(target, o);
    this.position = o.position + n;
    return n;
  }
}

/** Ogg duration = granule position of the last page / sample rate. */
async function oggDuration(client: HttpClient, url: string, size: number, sampleRate: number, opus: boolean): Promise<number | undefined> {
  const start = Math.max(0, size - 65536);
  const r = await client.request(url, { headers: { range: `bytes=${start}-${size - 1}` } });
  if (r.status !== 206) {
    await r.body?.cancel().catch(() => {});
    return undefined;
  }
  const { readLimited } = await import('./net');
  const b = await readLimited(r.body, 65536);
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53) {
      const dv = new DataView(b.buffer, b.byteOffset + i + 6, 8);
      const granule = Number(dv.getBigUint64(0, true));
      const rate = opus ? 48000 : sampleRate;
      if (granule > 0 && rate) return granule / rate;
    }
  }
  return undefined;
}

/**
 * Read tags from a remote file with HTTP Range requests (random access, so MP4 moov atoms at the end work).
 * Falls back to parsing the first 256KB when the server ignores Range.
 */
export async function readRemoteTags(client: HttpClient, url: string, base: RawTrack, headers?: Record<string, string>): Promise<RawTrack> {
  const { parseBuffer, parseFromTokenizer } = await mm();
  void headers;
  const h = await client.head(url, 256 * 1024);
  if (h.status >= 400) throw new Error(`HTTP ${h.status}`);
  const sniff = sniffAudio(h.bytes);
  const ct = h.headers.get('content-type') ?? '';
  const mime = sniff?.mime ?? (ct.startsWith('audio/') ? ct : undefined);
  const out: RawTrack = { ...base, size: h.total ?? base.size, format: base.format ?? sniff?.format ?? null, mime: base.mime ?? mime ?? null };
  if (!sniff && !ct.startsWith('audio/')) return { ...out, needsTags: false };
  let meta: IAudioMetadata | null = null;
  try {
    if (h.ranged && h.total) {
      const tok = new RangeTokenizer(client, h.url, h.total, mime, h.bytes);
      meta = await parseFromTokenizer(tok, { duration: false, skipPostHeaders: true });
    } else {
      meta = await parseBuffer(h.bytes, { mimeType: mime, size: h.total ?? undefined }, { duration: false, skipPostHeaders: true });
    }
  } catch {
    try {
      meta = await parseBuffer(h.bytes, { mimeType: mime, size: h.total ?? undefined }, { duration: false, skipPostHeaders: true });
    } catch {
      meta = null;
    }
  }
  if (!meta) return out;
  const r = fromMeta(meta, out);
  const fmt = (r.format ?? '').toLowerCase();
  if ((fmt === 'ogg' || fmt === 'opus') && h.ranged && h.total) {
    const d = await oggDuration(client, h.url, h.total, meta.format.sampleRate ?? 44100, fmt === 'opus' || /opus/i.test(meta.format.codec ?? '')).catch(() => undefined);
    if (d) r.duration = d;
  }
  if (!r.duration && r.bitrate && h.total) r.duration = Math.round((h.total * 8) / (r.bitrate * 1000));
  return r;
}
