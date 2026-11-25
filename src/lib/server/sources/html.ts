import * as cheerio from 'cheerio';
import { resolveUrl } from './parsers';
import { ARCHIVE_EXT, AUDIO_EXT, IMAGE_EXT, PLAYLIST_EXT, SKIP_EXT, extOf, safeDecode } from './media';

export type LinkKind = 'audio' | 'playlist' | 'archive' | 'image' | 'page' | 'probe' | 'skip';

export interface PageLink {
  url: string;
  text: string;
  kind: LinkKind;
  next?: boolean;
}

export interface PageInfo {
  title: string;
  isIndex: boolean;
  links: PageLink[];
  ogImage?: string;
  scriptHeavy: boolean;
  /** Metadata from JSON-LD keyed by URL */
  ld: Map<string, { title?: string; artist?: string; album?: string; duration?: string }>;
}

const SORT_KEYS = new Set(['c', 'o', 'sort', 'order', 'orderby', 'sortby', 's', 'direction', 'dir_sort', 'view', 'layout', 'lang', 'locale', 'theme', 'nd', 'mode']);
const PAGE_KEYS = /^(page|p|pg|pagenum|offset|start|from|cursor|after|skip|paged)$/i;
const DOWNLOAD_HINT = /(^|[/?&=_.-])(download|dl|get|file|files|stream|play|track|song|audio|media|attachment|fetch|serve)([/?&=_.-]|$)/i;
const PAGE_EXT = new Set(['', 'html', 'htm', 'xhtml', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'shtml', 'cfm']);
const NEXT_TEXT = /^\s*(next|next page|older|more|load more|»|›|>|>>|→|suivant|weiter|siguiente|próxima|следующая)\s*$/i;

export function linkKind(url: string, text = ''): LinkKind {
  const ext = extOf(url);
  if (AUDIO_EXT[ext]) return 'audio';
  if (PLAYLIST_EXT.has(ext) && ext !== 'cue') return 'playlist';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (SKIP_EXT.has(ext) || ext === 'cue') return 'skip';
  // Opaque endpoints whose link text names an audio file: "Song.mp3" → download?id=123
  const textExt = extOf(text.trim().replace(/\s+/g, '_'));
  if (AUDIO_EXT[textExt]) return 'probe';
  const u = new URL(url);
  if (DOWNLOAD_HINT.test(u.pathname + u.search) && (u.search || !PAGE_EXT.has(ext) || /download|stream|dl|get/i.test(u.pathname))) return 'probe';
  if (PAGE_EXT.has(ext) || !ext || /^\d+$/.test(ext) || ext.length > 5) return 'page';
  return 'probe';
}

/** Extract every useful link from an HTML document. */
export function extractPage(html: string, pageUrl: string): PageInfo {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').attr('href');
  const base = (baseHref && resolveUrl(baseHref, pageUrl)) || pageUrl;
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  const isIndex =
    /^(index of|directory listing|listing of)/i.test(title) ||
    /^index of/i.test($('h1').first().text().trim()) ||
    ($('div.listing table, table#list, #listing').length > 0 && /^\/.*\/?$/.test(title)) ||
    /^\/[^<>]*\/$/.test(title);
  const links = new Map<string, PageLink>();
  const add = (ref: string | undefined, text: string, opts: { kind?: LinkKind; next?: boolean } = {}) => {
    const url = resolveUrl(ref, base);
    if (!url) return;
    const t = text.replace(/\s+/g, ' ').trim();
    const existing = links.get(url);
    if (existing) {
      if (!existing.text && t) existing.text = t;
      if (opts.next) existing.next = true;
      return;
    }
    links.set(url, { url, text: t, kind: opts.kind ?? linkKind(url, t), next: opts.next });
  };

  $('a[href], area[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    const text = a.text() || a.attr('title') || a.attr('aria-label') || '';
    const rel = (a.attr('rel') ?? '').toLowerCase();
    const next = rel.includes('next') || NEXT_TEXT.test(text) || /\bnext\b/i.test(a.attr('class') ?? '') || /\bnext\b/i.test(a.attr('aria-label') ?? '');
    add(href, text, { next });
    if (a.attr('download') != null && href) {
      const url = resolveUrl(href, base);
      if (url && links.get(url)?.kind === 'page') links.get(url)!.kind = 'probe';
    }
  });
  $('link[rel="next"]').each((_, el) => add($(el).attr('href'), 'next', { next: true }));
  $('audio[src], audio source[src], source[src][type^="audio"], video source[src][type^="audio"], embed[src], track[src]').each((_, el) => {
    const s = $(el).attr('src');
    const url = resolveUrl(s, base);
    if (url) add(url, $(el).attr('title') ?? '', { kind: linkKind(url) === 'audio' ? 'audio' : 'probe' });
  });
  $('[data-src], [data-url], [data-audio], [data-file], [data-mp3], [data-track], [data-stream], [data-href]').each((_, el) => {
    for (const k of ['data-src', 'data-url', 'data-audio', 'data-file', 'data-mp3', 'data-track', 'data-stream', 'data-href']) {
      const v = $(el).attr(k);
      if (v && /[/.]/.test(v)) {
        const url = resolveUrl(v, base);
        if (url) {
          const kind = linkKind(url, $(el).text());
          if (kind === 'audio' || kind === 'probe' || kind === 'playlist') add(url, $(el).attr('data-title') ?? $(el).text(), { kind });
        }
      }
    }
  });
  $('meta[property="og:audio"], meta[property="og:audio:url"], meta[property="og:audio:secure_url"], meta[name="twitter:player:stream"]').each((_, el) => {
    add($(el).attr('content'), $('meta[property="og:title"]').attr('content') ?? '', { kind: 'audio' });
  });

  // JSON-LD (schema.org MusicRecording / AudioObject / MusicAlbum)
  const ld = new Map<string, { title?: string; artist?: string; album?: string; duration?: string }>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const visit = (n: unknown, album?: string, artist?: string) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach((x) => visit(x, album, artist));
        const o = n as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name : undefined;
        const by = o.byArtist as { name?: string } | string | undefined;
        const artistName = typeof by === 'string' ? by : by?.name ?? artist;
        const t = String(o['@type'] ?? '');
        const content = (o.audio as Record<string, unknown> | undefined)?.contentUrl ?? o.contentUrl ?? (o.audio as { url?: string } | undefined)?.url;
        if (typeof content === 'string') {
          const url = resolveUrl(content, base);
          if (url) {
            add(url, name ?? '', { kind: linkKind(url) === 'audio' ? 'audio' : 'probe' });
            ld.set(url, { title: name, artist: artistName, album, duration: typeof o.duration === 'string' ? o.duration : undefined });
          }
        }
        const nextAlbum = /album/i.test(t) ? name : album;
        for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v, nextAlbum, artistName);
      };
      visit(data);
    } catch {}
  });

  // Inline scripts / raw text: bare audio URLs (players that build playlists in JS)
  const scripts = $('script:not([src])').map((_, el) => $(el).text()).get().join('\n');
  const re = /["'(](https?:\/\/[^"'()\s<>]+?\.(?:mp3|flac|m4a|ogg|opus|wav|aac)(?:\?[^"'()\s<>]*)?)["')]/gi;
  let m;
  let n = 0;
  while ((m = re.exec(scripts)) && n++ < 5000) add(m[1].replace(/\\\//g, '/'), '', { kind: 'audio' });
  const reRel = /["']((?:\.{0,2}\/)?[^"'\s<>:]+?\.(?:mp3|flac|m4a|ogg|opus|wav|aac|m3u8?))["']/gi;
  n = 0;
  while ((m = reRel.exec(scripts)) && n++ < 5000) {
    const url = resolveUrl(m[1].replace(/\\\//g, '/'), base);
    if (url) add(url, '', {});
  }

  const ogImage = resolveUrl($('meta[property="og:image"]').attr('content'), base) ?? undefined;
  const scriptCount = $('script').filter((_, el) => !/json/i.test($(el).attr('type') ?? '')).length;
  const anchors = $('a[href]').length;
  const scriptHeavy = scriptCount > 0 && anchors < 8 && ($('#root, #app, #__next, [data-reactroot], [ng-app], [data-v-app]').length > 0 || $('body').text().trim().length < 400);
  return { title, isIndex, links: [...links.values()], ogImage, scriptHeavy, ld };
}

/** Decide whether a page link should be crawled given the scope. */
export function inScope(link: string, from: string, scopeRoot: URL, wide: boolean): boolean {
  const u = new URL(link);
  if (u.host !== scopeRoot.host) return false;
  const fromU = new URL(from);
  // Ignore sort/view variants of the same listing (Apache ?C=N;O=D, etc.)
  if (u.search) {
    const params = [...new URLSearchParams(u.search.replace(/;/g, '&')).keys()].map((k) => k.toLowerCase());
    if (params.length && params.every((k) => SORT_KEYS.has(k))) return false;
    if (u.pathname === fromU.pathname && !params.some((k) => PAGE_KEYS.test(k)) && params.every((k) => SORT_KEYS.has(k) || k === 'c' || k === 'o')) return false;
  }
  if (wide) return true;
  const sp = scopeRoot.pathname;
  const last = sp.split('/').pop() ?? '';
  // "/music/" → below /music/;  "/music/index.html" → below /music/;  "/details/item" → the page itself and below /details/item/
  const rootPath = sp.endsWith('/') ? sp : /\.[a-z0-9]{2,5}$/i.test(last) ? sp.replace(/[^/]*$/, '') : sp + '/';
  if (u.pathname === sp) return true;
  return safeDecode(u.pathname).startsWith(safeDecode(rootPath)) || u.pathname.startsWith(rootPath);
}

export function isCoverName(url: string) {
  const name = safeDecode(new URL(url).pathname.split('/').pop() ?? '').toLowerCase();
  return /^(cover|folder|front|album|albumart|albumartsmall|artwork|art)[^/]*\.(jpe?g|png|webp)$/.test(name) || /(^|[\s_-])(cover|front)([\s_.-]|$)/.test(name);
}

export function dirOf(url: string) {
  const u = new URL(url);
  u.search = '';
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.toString();
}
