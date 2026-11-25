#!/usr/bin/env node
/**
 * Serves the generated fixtures in many real-world "shapes" so the URL importer can be tested end-to-end:
 *   /apache/  /nginx/  /caddy/   autoindex listings in each server's HTML style
 *   /custom/                     a hand-made page: album cards, download.php?id=N links, data-src, JSON-LD, pagination
 *   /js/                         links injected by JavaScript (needs "Render JavaScript")
 *   /auth/                       HTTP Basic auth (demo / demo)
 *   /referer/                    files require a Referer header
 *   /norange/                    server that ignores Range requests
 *   /playlist.m3u /playlist.pls /playlist.xspf /feed.xml /manifest.json /album.zip
 *   /rest/*                      a minimal Subsonic API (user demo / pass demo)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.argv[2] ?? 'fixtures/out');
const PORT = Number(process.argv[3] ?? 4100);
const LIB = path.join(ROOT, 'library');

const MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', jpg: 'image/jpeg', png: 'image/png', zip: 'application/zip', m3u: 'audio/x-mpegurl', pls: 'audio/x-scpls', xspf: 'application/xspf+xml', xml: 'application/rss+xml', json: 'application/json' };
const mimeOf = (f) => MIME[path.extname(f).slice(1).toLowerCase()] ?? 'application/octet-stream';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

const allFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mp3|flac|m4a|ogg|opus)$/.test(e.name)) allFiles.push(p);
  }
})(LIB);

function sendFile(req, res, file, { range = true, headers = {} } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound(res);
  const size = fs.statSync(file).size;
  const base = { 'content-type': mimeOf(file), ...headers };
  const m = range && /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? Number(m[1]) : size - Number(m[2]);
    const end = m[2] && m[1] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'content-length': size, ...(range ? { 'accept-ranges': 'bytes' } : {}) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
const notFound = (res) => {
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end('<h1>404 Not Found</h1>');
};
const html = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
};

function listing(style, urlPath, dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const rows = entries.map((e) => ({ name: e.name + (e.isDirectory() ? '/' : ''), href: encodeURIComponent(e.name) + (e.isDirectory() ? '/' : ''), size: e.isDirectory() ? '-' : fs.statSync(path.join(dir, e.name)).size }));
  if (style === 'apache')
    return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html><head><title>Index of ${esc(urlPath)}</title></head><body><h1>Index of ${esc(urlPath)}</h1><table><tr><th valign="top"><img src="/icons/blank.gif" alt="[ICO]"></th><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th><th><a href="?C=S;O=A">Size</a></th></tr><tr><th colspan="5"><hr></th></tr><tr><td valign="top"><img src="/icons/back.gif" alt="[PARENTDIR]"></td><td><a href="../">Parent Directory</a></td><td>&nbsp;</td><td align="right">  - </td></tr>${rows
      .map((r) => `<tr><td valign="top"><img src="/icons/${r.name.endsWith('/') ? 'folder' : 'sound2'}.gif" alt="[   ]"></td><td><a href="${r.href}">${esc(r.name)}</a></td><td align="right">2024-05-01 12:00</td><td align="right">${r.size}</td></tr>`)
      .join('')}<tr><th colspan="5"><hr></th></tr></table><address>Apache/2.4.58 (Ubuntu) Server at localhost Port ${PORT}</address></body></html>`;
  if (style === 'nginx')
    return `<html>\r\n<head><title>Index of ${esc(urlPath)}</title></head>\r\n<body>\r\n<h1>Index of ${esc(urlPath)}</h1><hr><pre><a href="../">../</a>\r\n${rows.map((r) => `<a href="${r.href}">${esc(r.name.length > 50 ? r.name.slice(0, 47) + '..&gt;' : r.name)}</a>${' '.repeat(Math.max(1, 51 - r.name.length))}01-May-2024 12:00    ${r.size}\r\n`).join('')}</pre><hr></body>\r\n</html>\r\n`;
  // caddy
  return `<!DOCTYPE html><html><head><title>${esc(urlPath)}</title><meta charset="utf-8"></head><body><header><h1><a href="/">/</a>${esc(urlPath)}</h1></header><main><div class="listing"><table aria-describedby="summary"><thead><tr><th><a href="?sort=name&order=desc">Name</a></th><th><a href="?sort=size&order=asc">Size</a></th></tr></thead><tbody><tr><td><a href=".."><span class="goup">Go up</span></a></td></tr>${rows
    .map((r) => `<tr class="file"><td><a href="./${r.href}"><svg width="1.5em" height="1em" version="1.1" viewBox="0 0 317 259"><use xlink:href="#file"></use></svg><span class="name">${esc(r.name)}</span></a></td><td data-order="${r.size}">${r.size}</td></tr>`)
    .join('')}</tbody></table></div></main></body></html>`;
}

function serveListing(req, res, prefix, style, opts = {}) {
  const url = new URL(req.url, 'http://x');
  const rel = decodeURIComponent(url.pathname.slice(prefix.length));
  const target = path.join(LIB, rel);
  if (!target.startsWith(LIB)) return notFound(res);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    if (!url.pathname.endsWith('/')) {
      res.writeHead(301, { location: url.pathname + '/' });
      return res.end();
    }
    return html(res, listing(style, url.pathname, target));
  }
  return sendFile(req, res, target, opts);
}

/* ---------------- custom page ---------------- */
function customPage(page) {
  const per = 8;
  const slice = allFiles.slice((page - 1) * per, page * per);
  const pages = Math.ceil(allFiles.length / per);
  const cards = slice
    .map((f) => {
      const id = allFiles.indexOf(f) + 1;
      const name = path.basename(f);
      const album = path.basename(path.dirname(f));
      return `<div class="card"><img data-src="/custom/art/${id}.jpg" alt=""><h3>${esc(name.replace(/^\d+ - |\.\w+$/g, ''))}</h3><p>${esc(album)}</p><a class="btn" href="download.php?id=${id}" title="Download">${esc(name)}</a></div>`;
    })
    .join('');
  const ld = { '@context': 'https://schema.org', '@type': 'MusicPlaylist', name: 'Custom Page', track: slice.slice(0, 1).map((f) => ({ '@type': 'MusicRecording', name: 'JSON-LD Track', byArtist: { '@type': 'MusicGroup', name: 'LD Artist' }, audio: { '@type': 'AudioObject', contentUrl: `/custom/ld/${allFiles.indexOf(f) + 1}` } })) };
  const nav = page < pages ? `<a rel="next" href="?page=${page + 1}">Next »</a>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Indie Vault — page ${page}</title><meta property="og:image" content="/custom/og.jpg"><script type="application/ld+json">${JSON.stringify(ld)}</script><link rel="stylesheet" href="/custom/site.css"></head><body><nav><a href="/custom/about.html">About</a> <a href="/custom/?page=1&sort=name">Sort</a></nav><main class="grid">${cards}</main><footer>${nav}</footer></body></html>`;
}

/* ---------------- subsonic mock ---------------- */
const albums = new Map();
for (const f of allFiles) {
  const dir = path.dirname(f);
  if (!albums.has(dir)) albums.set(dir, []);
  albums.get(dir).push(f);
}
const albumList = [...albums.entries()].map(([dir, files], i) => ({ id: `al-${i}`, dir, files, name: path.basename(dir).replace(/\s*[\[(].*$/, ''), artist: path.basename(path.dirname(dir)) }));
const songId = (f) => 'so-' + allFiles.indexOf(f);
function subsonicAuth(q) {
  if (q.get('u') !== 'demo') return false;
  if (q.get('p')) return q.get('p') === 'demo' || q.get('p') === 'enc:' + Buffer.from('demo').toString('hex');
  return q.get('t') === crypto.createHash('md5').update('demo' + q.get('s')).digest('hex');
}
function subsonic(req, res, url) {
  const q = url.searchParams;
  const method = url.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
  const ok = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: '0.53.0', ...body } }));
  };
  if (method === 'ping' && !q.get('u')) return ok({});
  if (!subsonicAuth(q)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code: 40, message: 'Wrong username or password' } } }));
  }
  const song = (f, al) => ({ id: songId(f), title: path.basename(f).replace(/^\d+ - |\.\w+$/g, ''), album: al.name, artist: al.artist, track: Number(path.basename(f).slice(0, 2)) || undefined, suffix: path.extname(f).slice(1), contentType: mimeOf(f), size: fs.statSync(f).size, coverArt: al.id, duration: 25 });
  switch (method) {
    case 'ping':
      return ok({});
    case 'getAlbumList2': {
      const off = Number(q.get('offset') ?? 0);
      const size = Number(q.get('size') ?? 10);
      return ok({ albumList2: { album: albumList.slice(off, off + size).map((a) => ({ id: a.id, name: a.name, artist: a.artist, coverArt: a.id })) } });
    }
    case 'getAlbum': {
      const al = albumList.find((a) => a.id === q.get('id'));
      if (!al) return ok({});
      return ok({ album: { id: al.id, name: al.name, artist: al.artist, coverArt: al.id, song: al.files.map((f) => song(f, al)) } });
    }
    case 'getPlaylists':
      return ok({ playlists: { playlist: [{ id: 'pl-1', name: 'Subsonic Favourites' }] } });
    case 'getPlaylist':
      return ok({ playlist: { id: 'pl-1', entry: allFiles.slice(0, 3).map((f) => ({ id: songId(f) })) } });
    case 'stream': {
      const f = allFiles[Number(String(q.get('id')).slice(3))];
      return f ? sendFile(req, res, f) : notFound(res);
    }
    case 'getCoverArt': {
      const al = albumList.find((a) => a.id === q.get('id'));
      const c = al && path.join(al.dir, 'cover.jpg');
      return c && fs.existsSync(c) ? sendFile(req, res, c) : notFound(res);
    }
    default:
      return ok({});
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') return html(res, `<h1>Aurora fixture server</h1><ul>${['/apache/', '/nginx/', '/caddy/', '/custom/', '/js/', '/auth/', '/referer/', '/norange/', '/playlist.m3u', '/playlist.pls', '/playlist.xspf', '/feed.xml', '/manifest.json', '/album.zip', '/rest/ping.view'].map((x) => `<li><a href="${x}">${x}</a></li>`).join('')}</ul>`);
    if (p.startsWith('/apache/')) return serveListing(req, res, '/apache/', 'apache');
    if (p.startsWith('/nginx/')) return serveListing(req, res, '/nginx/', 'nginx');
    if (p.startsWith('/caddy/')) return serveListing(req, res, '/caddy/', 'caddy');
    if (p.startsWith('/norange/')) return serveListing(req, res, '/norange/', 'nginx', { range: false });
    if (p.startsWith('/auth/')) {
      const a = req.headers.authorization ?? '';
      if (a !== 'Basic ' + Buffer.from('demo:demo').toString('base64')) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="fixtures"', 'content-type': 'text/html' });
        return res.end('<h1>401 Authorization Required</h1>');
      }
      return serveListing(req, res, '/auth/', 'apache');
    }
    if (p.startsWith('/referer/')) {
      const isFile = /\.(mp3|flac|m4a|ogg|opus|jpg)$/i.test(p);
      if (isFile && !(req.headers.referer ?? '').includes('/referer/')) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('Hotlinking not allowed');
      }
      return serveListing(req, res, '/referer/', 'nginx');
    }
    if (p === '/custom/' || p === '/custom/index.html') return html(res, customPage(Math.max(1, Number(url.searchParams.get('page') ?? 1))));
    if (p === '/custom/download.php') {
      const f = allFiles[Number(url.searchParams.get('id')) - 1];
      return f ? sendFile(req, res, f, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` } }) : notFound(res);
    }
    if (p.startsWith('/custom/ld/')) {
      const f = allFiles[Number(p.split('/').pop()) - 1];
      return f ? sendFile(req, res, f) : notFound(res);
    }
    if (p.startsWith('/custom/art/') || p === '/custom/og.jpg') return sendFile(req, res, path.join(albumList[0].dir, 'cover.jpg'));
    if (p === '/custom/about.html') return html(res, '<html><head><title>About</title></head><body><p>A small indie vault. <a href="/custom/">Home</a></p></body></html>');
    if (p === '/custom/site.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end('body{font-family:sans-serif}');
    }
    if (p === '/js/' || p === '/js/index.html') return html(res, `<!doctype html><html><head><title>Player</title><script src="/js/app.js" defer></script></head><body><div id="app"></div></body></html>`);
    if (p === '/js/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`fetch('/js/data').then(r=>r.json()).then(d=>{const a=document.getElementById('app');for(const t of d){const l=document.createElement('a');l.href=t.u;l.textContent=t.n;a.appendChild(l)}})`);
    }
    if (p === '/js/data') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(allFiles.slice(0, 4).map((f) => ({ u: '/apache/' + enc(path.relative(LIB, f)), n: path.basename(f) }))));
    }
    if (p.startsWith('/rest/')) return subsonic(req, res, url);
    if (p.startsWith('/library/')) return sendFile(req, res, path.join(ROOT, decodeURIComponent(p)));
    const top = path.join(ROOT, decodeURIComponent(p));
    if (top.startsWith(ROOT) && fs.existsSync(top) && fs.statSync(top).isFile()) return sendFile(req, res, top);
    return notFound(res);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
server.listen(PORT, () => console.log(`Fixture server on http://127.0.0.1:${PORT} (${allFiles.length} audio files)`));
