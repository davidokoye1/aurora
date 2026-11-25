/** Media-type helpers shared by adapters: extension tables, magic-byte sniffing, path → metadata parsing. */

export const AUDIO_EXT: Record<string, { mime: string; browser: boolean }> = {
  mp3: { mime: 'audio/mpeg', browser: true },
  m4a: { mime: 'audio/mp4', browser: true },
  mp4: { mime: 'audio/mp4', browser: true },
  m4b: { mime: 'audio/mp4', browser: true },
  aac: { mime: 'audio/aac', browser: true },
  alac: { mime: 'audio/mp4', browser: true },
  flac: { mime: 'audio/flac', browser: true },
  ogg: { mime: 'audio/ogg', browser: true },
  oga: { mime: 'audio/ogg', browser: true },
  opus: { mime: 'audio/ogg', browser: true },
  webm: { mime: 'audio/webm', browser: true },
  weba: { mime: 'audio/webm', browser: true },
  wav: { mime: 'audio/wav', browser: true },
  wave: { mime: 'audio/wav', browser: true },
  aif: { mime: 'audio/aiff', browser: false },
  aiff: { mime: 'audio/aiff', browser: false },
  wma: { mime: 'audio/x-ms-wma', browser: false },
  ape: { mime: 'audio/ape', browser: false },
  wv: { mime: 'audio/wavpack', browser: false },
  dsf: { mime: 'audio/dsf', browser: false },
};
export const PLAYLIST_EXT = new Set(['m3u', 'm3u8', 'pls', 'xspf', 'cue']);
export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const ARCHIVE_EXT = new Set(['zip']);
/** Extensions that are clearly not worth crawling or probing. */
export const SKIP_EXT = new Set([
  'txt', 'nfo', 'sfv', 'md5', 'log', 'pdf', 'doc', 'docx', 'exe', 'msi', 'dmg', 'iso', 'torrent', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'css', 'js', 'mjs', 'ico', 'svg', 'woff', 'woff2', 'ttf', 'eot', 'mkv', 'avi', 'mov', 'srt', 'sub', 'apk', 'xml', 'sig', 'asc',
]);

export function extOf(pathOrUrl: string): string {
  let p = pathOrUrl;
  try {
    p = new URL(pathOrUrl).pathname;
  } catch {}
  p = safeDecode(p);
  const base = p.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%20'));
  } catch {
    try {
      return decodeURI(s);
    } catch {
      return s;
    }
  }
}

export function mimeToFormat(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const m = mime.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpeg3': 'mp3', 'audio/x-mpeg': 'mp3',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/aacp': 'aac',
    'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/opus': 'opus',
    'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
    'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff', 'audio/x-ms-wma': 'wma',
  };
  if (map[m]) return map[m];
  if (m.startsWith('audio/')) return m.slice(6);
  return null;
}

/** Sniff audio container by magic bytes. */
export function sniffAudio(b: Uint8Array): { format: string; mime: string } | null {
  if (b.length < 12) return null;
  const s = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (s(0, 3) === 'ID3') return { format: 'mp3', mime: 'audio/mpeg' };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) {
    // MPEG audio frame sync; distinguish ADTS AAC (layer bits == 00)
    if ((b[1] & 0x06) === 0) return { format: 'aac', mime: 'audio/aac' };
    return { format: 'mp3', mime: 'audio/mpeg' };
  }
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { format: 'aac', mime: 'audio/aac' };
  if (s(0, 4) === 'fLaC') return { format: 'flac', mime: 'audio/flac' };
  if (s(0, 4) === 'OggS') {
    const head = s(0, Math.min(b.length, 80));
    return head.includes('OpusHead') ? { format: 'opus', mime: 'audio/ogg' } : { format: 'ogg', mime: 'audio/ogg' };
  }
  if (s(4, 4) === 'ftyp') {
    const brand = s(8, 4);
    if (/^(M4A |M4B |mp42|isom|iso2|dash|M4P )/.test(brand)) return { format: 'm4a', mime: 'audio/mp4' };
    return { format: 'm4a', mime: 'audio/mp4' };
  }
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return { format: 'wav', mime: 'audio/wav' };
  if (s(0, 4) === 'FORM' && (s(8, 4) === 'AIFF' || s(8, 4) === 'AIFC')) return { format: 'aiff', mime: 'audio/aiff' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { format: 'webm', mime: 'audio/webm' };
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return { format: 'wma', mime: 'audio/x-ms-wma' };
  return null;
}

export function sniffZip(b: Uint8Array) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) ;
}

export function browserPlayable(format: string | null | undefined): boolean {
  if (!format) return true;
  const f = AUDIO_EXT[format];
  return f ? f.browser : !['wma', 'aiff', 'ape', 'wv', 'dsf'].includes(format);
}

const GENERIC_DIRS = /^(music|musik|musique|mp3s?|flacs?|audio|songs?|tracks?|downloads?|files?|media|library|albums?|artists?|various|incoming|share[sd]?|public|pub|data|www|html|htdocs|index|root|home|users?|uploads?|collection|archive|\d{1,2})$/i;

export interface PathMeta {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
}

function stripYear(s: string): { text: string; year?: number } {
  let year: number | undefined;
  const text = s
    .replace(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/, (_m, y) => {
      year = Number(y);
      return '';
    })
    .replace(/^((?:19|20)\d{2})\s*[-–.]\s+/, (_m, y) => {
      year = Number(y);
      return '';
    })
    .replace(/\s*[\[(](?:flac|mp3|320|v0|v2|web|cd|vinyl|24bit|16bit|24-\d+|hi-?res|lossless|\d+\s*kbps)[^\])]*[\])]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, year };
}

const clean = (s: string) =>
  s
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–.]+|[\s\-–.]+$/g, '')
    .trim();

/**
 * Infer metadata from a path like "Artist/Album (2001)/CD1/01 - Title.flac" or
 * "Artist - Album [2001]/03. Artist - Title.mp3". Used when tags are missing.
 */
export function parsePath(rawPath: string): PathMeta {
  const segs = safeDecode(rawPath)
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const file = segs.pop() ?? '';
  let base = file.replace(/\.[a-z0-9]{2,5}$/i, '');
  const out: PathMeta = {};

  // Disc folders ("CD1", "Disc 2")
  const dirs = segs.filter((d) => !GENERIC_DIRS.test(d));
  const last = dirs[dirs.length - 1];
  if (last && /^(cd|dis[ck])\s*[-_]?\s*(\d{1,2})$/i.test(last)) {
    out.discNo = Number(/(\d{1,2})$/.exec(last)![1]);
    dirs.pop();
  }

  // Track number prefix: "01 - ", "1-03 ", "01. ", "A1 "
  base = base.replace(/_/g, ' ');
  let m = /^(\d{1,2})[-.](\d{1,3})[\s.\-_]+(.+)$/.exec(base);
  if (m && Number(m[1]) <= 9) {
    out.discNo = out.discNo ?? Number(m[1]);
    out.trackNo = Number(m[2]);
    base = m[3];
  } else if ((m = /^(\d{1,3})(?:\s*[-.):_]\s*|\s+)(.+)$/.exec(base))) {
    if (!/^(19|20)\d{2}$/.test(m[1]) || base.length > 6) {
      out.trackNo = Number(m[1]);
      base = m[2];
    }
  } else if ((m = /^([A-D]\d{1,2})[\s.\-]+(.+)$/.exec(base))) {
    base = m[2];
  }

  // strip encoder/bitrate noise common in archive dumps: "Song 64kb", "Song_vbr", "Song 11KHz"
  base = base.replace(/[\s_.-]*(\d{2,3}\s?kb(ps)?|vbr|cbr|\d{1,2}(\.\d)?\s?khz|\d{1,2}bit|hq|lq)\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  let parts = base.split(/\s+[-–—]\s+/).map(clean).filter(Boolean);
  if (parts.length === 1) {
    // "Eubie Blake-Charleston Rag": a multi-word name glued to the title with a bare hyphen
    const m = /^([^-]*\s[^-]*)-([^-\s][^-]*)$/.exec(base);
    if (m && m[1].length >= 4 && m[2].length >= 3) parts = [clean(m[1]), clean(m[2])];
  }
  if (parts.length >= 3 && /^\d{1,3}$/.test(parts[parts.length - 2])) {
    // "Artist - Album - 03 - Title"
    out.artist = parts[0];
    out.album = parts[1];
    out.trackNo = Number(parts[parts.length - 2]);
    out.title = parts[parts.length - 1];
  } else if (parts.length >= 3) {
    out.artist = parts[0];
    out.album = parts.slice(1, -1).join(' - ');
    out.title = parts[parts.length - 1];
  } else if (parts.length === 2) {
    out.artist = parts[0];
    out.title = parts[1];
  } else {
    out.title = clean(base);
  }

  // Album folder
  if (dirs.length) {
    const { text, year } = stripYear(dirs[dirs.length - 1]);
    if (year) out.year = year;
    const ap = text.split(/\s+[-–—]\s+/).map(clean).filter(Boolean);
    if (ap.length >= 2) {
      out.albumArtist = ap[0];
      if (!out.album) out.album = ap.slice(1).join(' - ');
      if (!out.artist) out.artist = ap[0];
    } else if (!out.album) {
      out.album = clean(text);
    }
    // Artist folder
    if (dirs.length >= 2 && !out.albumArtist) {
      const a = clean(stripYear(dirs[dirs.length - 2]).text);
      if (a) {
        out.albumArtist = a;
        if (!out.artist) out.artist = a;
      }
    }
  }
  // If the "artist" parsed from filename equals the album, drop it
  if (out.artist && out.album && out.artist === out.album && out.albumArtist && out.albumArtist !== out.artist) out.artist = out.albumArtist;
  return out;
}
