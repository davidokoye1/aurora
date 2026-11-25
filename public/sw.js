/* Aurora service worker: app-shell + data caching so the app opens offline.
   Audio for offline playback lives in IndexedDB (managed by the page), not here. */
const VERSION = 'aurora-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const ART = `${VERSION}-art`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/downloads', '/manifest.webmanifest', '/icons/icon-192.png'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = (await caches.open(SHELL)).match(fallbackUrl) || cache.match(fallbackUrl);
      const r = await fb;
      if (r) return r;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  // Never cache streams, live events or auth
  if (p.startsWith('/api/stream') || p.startsWith('/api/sources/events') || p.startsWith('/api/auth') || req.headers.get('range')) return;
  if (p.startsWith('/_next/static/') || p.startsWith('/icons/')) return e.respondWith(cacheFirst(req, SHELL));
  if (p.startsWith('/api/art/')) return e.respondWith(cacheFirst(req, ART));
  if (p.startsWith('/api/')) return e.respondWith(networkFirst(req, DATA));
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, SHELL, '/downloads'));
  if (req.headers.get('rsc') || url.searchParams.has('_rsc')) return e.respondWith(networkFirst(req, SHELL));
});
