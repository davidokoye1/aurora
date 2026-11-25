import 'server-only';
import { HttpClient } from '../net';
import type { DetectResult, SourceConfig } from './types';
import { probe, subsonicBase, subsonicCall, jellyfinBase, renderWithBrowser, archiveItemId, archiveItem } from './adapters';
import { extractPage } from './html';
import { looksLikeFeed, looksLikeM3U, parseFeed, parseM3U, parsePLS, parseXSPF, walkManifest } from './parsers';
import { AUDIO_EXT, extOf, parsePath, safeDecode } from './media';

function niceName(url: string, title?: string) {
  if (title && !/^index of/i.test(title) && title.length < 80) return title;
  const u = new URL(url);
  const segs = safeDecode(u.pathname).split('/').filter(Boolean);
  return segs.length ? segs[segs.length - 1].replace(/\.[a-z0-9]+$/i, '') : u.host;
}

function previewOf(locators: { locator: string; title?: string; artist?: string; pathHint?: string; textHint?: string }[]) {
  return locators.slice(0, 12).map((t) => {
    const meta = parsePath(t.pathHint ?? new URL(t.locator.replace(/^zip:/, '')).pathname);
    const title = t.title ?? meta.title ?? t.textHint ?? t.locator;
    const artist = t.artist ?? meta.artist;
    return { title, detail: [artist, meta.album].filter(Boolean).join(' · ') || undefined };
  });
}

/**
 * Work out what kind of source a pasted URL is. Probes Subsonic/Jellyfin APIs when the URL looks like a server root,
 * then fetches the URL and inspects content type, magic bytes and body.
 */
export async function detectSource(rawUrl: string, cfg: SourceConfig): Promise<DetectResult> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  const u = new URL(url);
  const client = new HttpClient({ ...cfg, retries: 1, concurrency: 4 });
  const warnings: string[] = [];
  const segs = u.pathname.split('/').filter(Boolean);
  const ext = extOf(url);

  // 0. Internet Archive items expose per-file metadata
  const ia = archiveItemId(url);
  if (ia) {
    const item = await archiveItem(client, ia);
    const songs = new Set(item.tracks.map((t) => `${t.title ?? ''}|${t.trackNo ?? ''}|${(t.pathHint ?? '').replace(/(_64kb|_vbr)?\.[a-z0-9]+$/i, '')}`)).size;
    return {
      type: 'http', label: 'Internet Archive item', detail: `${item.tracks.length} audio files (${songs} songs across formats)${item.creator ? ` by ${item.creator}` : ''}.`,
      preview: item.tracks.slice(0, 12).map((t) => ({ title: t.title ?? t.locator.split('/').pop()!, detail: [t.artist, t.album].filter(Boolean).join(' · ') })),
      counts: { audio: item.tracks.length }, finalUrl: url, name: item.title, warnings,
    };
  }

  // 1. Media server APIs
  if (!AUDIO_EXT[ext] && !['m3u', 'm3u8', 'pls', 'xspf', 'json', 'xml', 'rss', 'zip'].includes(ext) && (segs.length <= 2 || /rest|subsonic|navidrome|jellyfin|emby/i.test(u.pathname))) {
    try {
      const r = await client.json<Record<string, unknown>>(`${subsonicBase(url)}/rest/ping.view?f=json&v=1.16.1&c=aurora`);
      const sr = r['subsonic-response'] as { status: string; error?: { code: number }; type?: string; serverVersion?: string } | undefined;
      if (sr) {
        const product = sr.type ? `${sr.type[0].toUpperCase()}${sr.type.slice(1)}` : 'Subsonic-compatible server';
        let needsAuth: DetectResult['needsAuth'] = 'subsonic';
        const preview: DetectResult['preview'] = [];
        if (cfg.username) {
          try {
            const al = await subsonicCall<{ albumList2?: { album?: { name: string; artist: string }[] } }>(client, { ...cfg, url }, 'getAlbumList2', { type: 'newest', size: '12' });
            for (const a of al.albumList2?.album ?? []) preview.push({ title: a.name, detail: a.artist });
            needsAuth = null;
          } catch (e) {
            warnings.push((e as Error).message);
          }
        }
        return { type: 'subsonic', label: product, detail: `${product}${sr.serverVersion ? ' ' + sr.serverVersion : ''} — sign in with your server account.`, needsAuth, preview, finalUrl: subsonicBase(url), name: product, warnings };
      }
    } catch {}
    try {
      const info = await client.json<{ ServerName?: string; ProductName?: string; Version?: string; Id?: string }>(`${jellyfinBase(url)}/System/Info/Public`);
      if (info && info.Id && (info.ProductName || info.ServerName)) {
        const product = /emby/i.test(info.ProductName ?? '') ? 'Emby' : 'Jellyfin';
        return {
          type: 'jellyfin', label: product, detail: `${product} server "${info.ServerName ?? ''}" ${info.Version ?? ''} — sign in or paste an API key.`,
          needsAuth: cfg.apiKey || cfg.username ? null : 'jellyfin', preview: [], finalUrl: jellyfinBase(url), name: info.ServerName ?? product, warnings,
        };
      }
    } catch {}
  }

  // 2. Fetch the resource itself
  const p = await probe(client, url).catch((e: Error) => {
    throw new Error(`Couldn't reach ${u.host}: ${e.message}`);
  });
  if (p.status === 401) {
    return { type: 'http', label: 'Protected page', detail: 'The server asks for a username and password.', needsAuth: 'basic', preview: [], finalUrl: p.finalUrl, name: niceName(p.finalUrl), warnings };
  }
  if (p.status === 403) warnings.push('The server returned 403 Forbidden. It may need a cookie, Referer or User-Agent header — add them under Access options.');
  else if (p.status >= 400) throw new Error(`The server responded with HTTP ${p.status}.`);

  const finalUrl = p.finalUrl;
  switch (p.kind) {
    case 'audio':
      return { type: 'http', label: 'Audio file', detail: `A single ${p.format?.toUpperCase() ?? 'audio'} file.`, preview: previewOf([{ locator: finalUrl, pathHint: new URL(finalUrl).pathname }]), counts: { audio: 1 }, finalUrl, name: niceName(finalUrl), warnings };
    case 'zip':
      return { type: 'http', label: 'Zip archive', detail: 'A zip archive — audio files inside it will be imported.', preview: [], counts: { archives: 1 }, finalUrl, name: niceName(finalUrl), warnings };
    case 'm3u':
    case 'pls':
    case 'xspf': {
      const { text } = await client.text(finalUrl);
      const parsed = p.kind === 'pls' ? parsePLS(text, finalUrl) : p.kind === 'xspf' ? parseXSPF(text, finalUrl) : parseM3U(text, finalUrl);
      return { type: 'playlist', label: `${p.kind.toUpperCase()} playlist`, detail: `${parsed.entries.length} entries${parsed.nested.length ? ` + ${parsed.nested.length} nested playlists` : ''}.`, preview: previewOf(parsed.entries), counts: { audio: parsed.entries.length }, finalUrl, name: parsed.name ?? niceName(finalUrl), warnings };
    }
    case 'feed': {
      const { text } = await client.text(finalUrl, 64 * 1024 * 1024);
      const f = parseFeed(text, finalUrl);
      return { type: 'rss', label: 'Podcast / RSS feed', detail: `${f.entries.length} episodes${f.author ? ` by ${f.author}` : ''}.`, preview: previewOf(f.entries), counts: { audio: f.entries.length }, finalUrl, name: f.name ?? niceName(finalUrl), warnings };
    }
    case 'json': {
      const { text } = await client.text(finalUrl, 256 * 1024 * 1024);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('The URL returned invalid JSON.');
      }
      const m = walkManifest(json, finalUrl);
      if (!m.entries.length) throw new Error('This JSON has no recognisable track URLs. See Settings → Sources → "Manifest format" for the expected shape.');
      return { type: 'manifest', label: 'JSON manifest', detail: `${m.entries.length} tracks${m.playlists.length ? `, ${m.playlists.length} playlists` : ''}.`, preview: previewOf(m.entries), counts: { audio: m.entries.length, playlists: m.playlists.length }, finalUrl, name: m.name ?? niceName(finalUrl), warnings };
    }
    case 'html':
    default: {
      const { text, url: fu } = await client.text(finalUrl);
      if (looksLikeFeed(text)) return detectSource(fu, { ...cfg });
      if (looksLikeM3U(text) && !/<html/i.test(text)) {
        const parsed = parseM3U(text, fu);
        return { type: 'playlist', label: 'M3U playlist', detail: `${parsed.entries.length} entries.`, preview: previewOf(parsed.entries), counts: { audio: parsed.entries.length }, finalUrl: fu, name: niceName(fu), warnings };
      }
      let info = extractPage(text, fu);
      let rendered = false;
      if (cfg.renderJs) {
        try {
          info = extractPage(await renderWithBrowser(fu, cfg), fu);
          rendered = true;
        } catch (e) {
          warnings.push((e as Error).message);
        }
      }
      const audio = info.links.filter((l) => l.kind === 'audio');
      const probes = info.links.filter((l) => l.kind === 'probe');
      const pages = info.links.filter((l) => l.kind === 'page' && new URL(l.url).host === u.host);
      const folders = pages.filter((l) => l.url.endsWith('/') && l.url.startsWith(fu.replace(/[^/]*$/, '')) && l.url !== fu);
      const playlists = info.links.filter((l) => l.kind === 'playlist');
      const archives = info.links.filter((l) => l.kind === 'archive');
      const suggestRenderJs = !rendered && info.scriptHeavy && audio.length === 0;
      if (suggestRenderJs) warnings.push('This page seems to load its content with JavaScript. Turn on "Render JavaScript" so Aurora can see the links.');
      if (!audio.length && !probes.length && !folders.length && !playlists.length && !archives.length && !pages.length) {
        warnings.push('No audio links or sub-pages were found on this page.');
      }
      const label = info.isIndex ? 'Directory listing' : 'Web page';
      const bits = [
        audio.length && `${audio.length} audio file${audio.length === 1 ? '' : 's'}`,
        probes.length && `${probes.length} download link${probes.length === 1 ? '' : 's'} to check`,
        folders.length && `${folders.length} folder${folders.length === 1 ? '' : 's'}`,
        !folders.length && pages.length && `${pages.length} linked page${pages.length === 1 ? '' : 's'}`,
        playlists.length && `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`,
        archives.length && `${archives.length} archive${archives.length === 1 ? '' : 's'}`,
      ].filter(Boolean);
      const preview = previewOf(audio.map((a) => ({ locator: a.url, pathHint: new URL(a.url).pathname, textHint: a.text })));
      if (!preview.length) for (const f of folders.slice(0, 12)) preview.push({ title: safeDecode(f.url.replace(/\/$/, '').split('/').pop() ?? f.url), detail: 'Folder' });
      return {
        type: 'http', label, detail: bits.length ? `Found ${bits.join(', ')} on the first page. Sub-folders will be crawled.` : 'Nothing obvious on the first page.',
        suggestRenderJs, preview, counts: { audio: audio.length, folders: folders.length, playlists: playlists.length, archives: archives.length },
        finalUrl: fu, name: niceName(fu, info.isIndex ? undefined : info.title), warnings,
      };
    }
  }
}
