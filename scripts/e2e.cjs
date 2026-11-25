#!/usr/bin/env node
/**
 * End-to-end check of the main user journeys against a running Aurora + fixture server.
 *   node scripts/fixture-server.mjs fixtures/out 4100 &
 *   DATA_DIR=./data-e2e npm run dev &
 *   node scripts/e2e.cjs [baseUrl] [fixtureUrl] [screenshotDir]
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const B = process.argv[2] ?? 'http://127.0.0.1:3000';
const F = process.argv[3] ?? 'http://127.0.0.1:4100';
const SHOTS = process.argv[4] ?? path.resolve('test-results/screens');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function playerTime(p) {
  return p.$eval('[aria-label="Player"] input[aria-label="Seek"]', (e) => Number(e.value)).catch(() => -1);
}
async function advancing(p, ms = 2500) {
  const a = await playerTime(p);
  await p.waitForTimeout(ms);
  const b = await playerTime(p);
  return { a, b, ok: b > a };
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource: the server responded with a status of (404|409)|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(`console ${p.url()}: ${m.text().slice(0, 200)}`));
  const email = `e2e${Date.now()}@example.com`;

  // 1. Sign up
  await p.goto(B + '/signup');
  await p.fill('#name', 'Robin');
  await p.fill('#email', email);
  await p.fill('#password', 'correct-horse-9');
  await p.click('button[type=submit]');
  await p.waitForURL(/\/setup/, { timeout: 60000, waitUntil: 'commit' });
  check('sign up opens “Add your music”', true);
  await p.evaluate(() => fetch('/api/admin/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowSignup: true }) }));

  // 1b. Choose a music folder with the picker (no typing paths)
  const MUSIC = '/tmp/aurora-e2e-music';
  fs.rmSync(MUSIC, { recursive: true, force: true });
  fs.rmSync(MUSIC + '-unplugged', { recursive: true, force: true });
  fs.mkdirSync(MUSIC, { recursive: true });
  for (const a of ['Kinetic Youth', 'The Quiet Fields']) fs.cpSync(path.resolve('fixtures/out/library', a), path.join(MUSIC, a), { recursive: true });
  await p.waitForSelector('text=Folders on this computer or a drive');
  await p.click('text=Folders on this computer or a drive');
  await p.click('[data-testid="folder-picker"] button:has-text("Computer")');
  await p.waitForSelector('[data-testid="audio-count"]:not(:has-text("Counting"))', { timeout: 30000 });
  await p.getByRole('button', { name: 'tmp', exact: true }).click();
  await p.waitForSelector('[data-testid="audio-count"]:not(:has-text("Counting"))', { timeout: 30000 });
  await p.getByRole('button', { name: 'aurora-e2e-music', exact: true }).click();
  await p.waitForSelector('[data-testid="audio-count"]:has-text("songs in here")', { timeout: 15000 });
  const countText = await p.textContent('[data-testid="audio-count"]');
  await p.click('button:has-text("Use this folder")');
  await p.waitForSelector('a:has-text("Start listening")', { timeout: 60000 });
  await p.screenshot({ path: `${SHOTS}/setup.png` });
  check('pick a folder in setup → songs import', true, `${countText}; ${await p.textContent('a:has-text("Start listening")')}`);
  await p.goto(B + '/sources?add=upload', { waitUntil: 'networkidle' });

  // 2. Upload files
  const lib = path.resolve('fixtures/out/library');
  const files = ['Lumen Ensemble/Tidal Rooms (2016)/01 - Breathing Glass.flac', 'Mara Velvet/Silk Hours (2020)/01 - Velvet Room.ogg'].map((f) => path.join(lib, f));
  await p.setInputFiles('input[type=file][accept^="audio"]', files);
  await p.waitForSelector('text=/2 songs added/', { timeout: 60000 });
  check('upload two files', true);
  await p.setInputFiles('input[type=file][accept^="audio"]', files);
  await p.waitForSelector('text=/already in your library/', { timeout: 60000 });
  check('re-uploading the same files skips them', true);

  // 3. Paste a URL → detect → import
  await p.click('button:has-text("Network / URL")');
  await p.fill('input[aria-label="Source URL"]', `${F}/nginx/`);
  await p.click('button:has-text("Detect")');
  await p.waitForSelector('text=Directory listing', { timeout: 60000 });
  check('detect nginx directory listing', true);
  await p.click('button:has-text("Import library")');
  const waitSources = async (n) => {
    for (let i = 0; i < 90; i++) {
      const s = await p.evaluate(() => fetch('/api/sources').then((r) => r.json()));
      const urlSources = s.filter((x) => x.type !== 'upload');
      if (urlSources.length >= n && urlSources.every((x) => x.status !== 'syncing' && x.job?.status !== 'running')) return s;
      await p.waitForTimeout(1000);
    }
    return p.evaluate(() => fetch('/api/sources').then((r) => r.json()));
  };
  let sources = await waitSources(1);
  const nginx = sources.find((s) => s.url?.includes('/nginx/'));
  check('nginx source imported', nginx?.trackCount >= 15, `${nginx?.trackCount} tracks, health ${nginx?.health?.playable}/${nginx?.health?.sampled}`);
  // more sources through the API (same validation path)
  for (const body of [
    { type: 'subsonic', name: 'Home server', url: `${F}/`, config: { username: 'demo', password: 'demo' } },
    { type: 'manifest', name: 'Manifest', url: `${F}/manifest.json` },
    { type: 'rss', name: 'Radio Hour', url: `${F}/feed.xml` },
    { type: 'http', name: 'Zip', url: `${F}/album.zip` },
  ]) {
    await p.evaluate((b) => fetch('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }), body);
  }
  sources = await waitSources(5);
  check('all URL sources synced', sources.filter((s) => s.type !== 'upload').every((s) => s.status === 'ok'), sources.map((s) => `${s.name}:${s.status}:${s.trackCount}`).join(', '));
  await p.screenshot({ path: `${SHOTS}/sources.png` });

  // 4. Home
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.waitForSelector('text=/Daily Mix \\d/', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  const mixes = await p.locator('text=/Daily Mix \\d/').count();
  check('home shows daily mixes', mixes > 0, `${mixes} mix cards`);
  await p.screenshot({ path: `${SHOTS}/home.png` });

  // 5. Album playback
  await p.goto(B + '/library?tab=albums', { waitUntil: 'networkidle' });
  await p.click('a[href^="/album/"]:has-text("Midnight Coastline")');
  await p.waitForSelector('button[aria-label^="Play Midnight"]:visible');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${SHOTS}/album.png` });
  await p.click('button[aria-label^="Play Midnight"]:visible');
  await p.waitForSelector('[aria-label="Player"]');
  await p.waitForTimeout(1500);
  let adv = await advancing(p);
  check('audio plays and time advances', adv.ok, `${adv.a} → ${adv.b}`);
  await p.click('[aria-label="Player"] button[aria-label="Next"]');
  await p.waitForTimeout(1500);
  const title2 = await p.textContent('[aria-label="Player"] .truncate');
  check('next track', title2?.includes('Chrome Skyline'), title2);
  await p.click('[aria-label="Player"] button[aria-label="Enable shuffle"]');
  await p.click('[aria-label="Player"] button[aria-label="Enable repeat"]');
  check('shuffle + repeat toggles', (await p.locator('[aria-label="Player"] button[aria-label="Disable shuffle"]').count()) === 1);
  await p.click('[aria-label="Player"] button[aria-label="Disable shuffle"]');
  // keyboard seek
  await p.locator('body').press('ArrowRight');
  await p.waitForTimeout(400);
  check('keyboard seek', (await playerTime(p)) >= 5);

  // 6. Lyrics + queue panels
  await p.click('button[aria-label="Lyrics"]');
  await p.waitForSelector('aside[aria-label="Lyrics"]');
  await p.waitForTimeout(3000);
  check('lyrics panel opens', true, (await p.textContent('aside[aria-label="Lyrics"]'))?.slice(0, 60));
  await p.click('button[aria-label="Queue"]');
  await p.waitForSelector('aside[aria-label="Queue"]');
  check('queue panel shows upcoming', (await p.locator('aside[aria-label="Queue"] >> text=Next from').count()) > 0);

  // 7. Playlist: create, add, reorder (drag), persist
  const pl = await p.evaluate(async () => {
    const tracks = await fetch('/api/library/tracks?limit=6').then((r) => r.json());
    const r = await fetch('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'E2E Mix', trackIds: tracks.tracks.slice(0, 4).map((t) => t.id) }) });
    return r.json();
  });
  await p.goto(`${B}/playlist/${pl.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const order = () => p.evaluate((id) => fetch(`/api/playlists/${id}`).then((r) => r.json()).then((d) => d.entries.map((e) => e.track.title)), pl.id);
  const before = await order();
  let after = before;
  for (let attempt = 0; attempt < 3 && after[0] === before[0]; attempt++) {
    const rows = p.locator('[role="grid"]').first().locator('[role="row"]');
    await rows.nth(1).hover();
    await p.waitForTimeout(300);
    const handle = rows.nth(1).locator('[aria-label="Drag to reorder"]');
    const a = await handle.boundingBox();
    const target = await rows.nth(3).boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((target.y + target.height * 0.7 - a.y) * i) / 20);
    await p.waitForTimeout(150);
    await p.mouse.up();
    await p.waitForTimeout(1200);
    after = await order();
  }
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const domFirst = await p.locator('[role="grid"]').first().locator('[role="row"]').nth(1).locator('.truncate').first().textContent();
  check('drag-and-drop reorder persists after reload', after[0] !== before[0] && after.includes(before[0]) && domFirst === after[0], `${before.join(' | ')}  →  ${after.join(' | ')}`);
  await p.screenshot({ path: `${SHOTS}/playlist.png` });

  // 8. Likes
  await p.locator('[role="row"]').nth(1).hover();
  await p.locator('[role="row"]').nth(1).locator('button[aria-label="Save to Liked Songs"]').click();
  await p.waitForTimeout(600);
  await p.goto(B + '/liked', { waitUntil: 'networkidle' });
  check('liked song appears in Liked Songs', (await p.locator('[role="row"]').count()) >= 2);

  // 9. Natural-language playlist
  await p.goto(B + '/discover', { waitUntil: 'networkidle' });
  await p.fill('input[aria-label="Describe your playlist"]', 'Make me a playlist for a late-night drive');
  await p.click('button:has-text("Generate")');
  await p.waitForSelector('text=/songs ·/', { timeout: 30000 });
  const nlCount = await p.locator('section [role="row"]').count();
  const chips = await p.locator('section span.rounded-full.text-xs').allTextContents();
  check('AI playlist generated from prompt', nlCount > 0, `${nlCount} tracks, chips: ${chips.join(', ')}`);
  await p.screenshot({ path: `${SHOTS}/discover.png` });

  // 10. Search with a typo
  await p.goto(B + '/search?q=satelite%20harts', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  check('typo-tolerant search', (await p.locator('text=Satellite Hearts').count()) > 0);

  // 11. Download an album and play it offline
  await p.goto(B + '/library?tab=albums', { waitUntil: 'networkidle' });
  await p.click('a[href^="/album/"]:has-text("Barley & Light")');
  await p.waitForSelector('button[aria-label="Download"]:visible');
  await p.click('button[aria-label="Download"]:visible');
  await p.waitForSelector('button[aria-label="Downloaded — remove download"]:visible', { timeout: 60000 });
  check('album downloaded for offline', true);
  await p.goto(B + '/downloads', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${SHOTS}/downloads.png` });
  await ctx.setOffline(true);
  await p.click('button:has-text("Play all")');
  await p.waitForTimeout(1500);
  adv = await advancing(p);
  check('downloaded music plays while offline', adv.ok, `${adv.a} → ${adv.b}`);
  await ctx.setOffline(false);

  // 12. Stats after listening
  await p.click('[aria-label="Player"] button[aria-label="Pause"]').catch(() => {});
  await p.goto(B + '/stats', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${SHOTS}/stats.png` });
  check('stats page renders', (await p.locator('text=Minutes listened').count()) > 0 || (await p.locator('text=No listening in this period').count()) > 0);

  // 13. Full-screen player
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.click('button[aria-label="Full-screen player"]');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${SHOTS}/full-player.png` });
  await p.keyboard.press('Escape');

  // 14. Responsive layouts + phone interaction model
  const cookies = await ctx.cookies();
  {
    const c2 = await browser.newContext({ viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await c2.addCookies(cookies);
    const m = await c2.newPage();
    m.on('pageerror', (e) => errors.push(`pageerror(tablet) ${m.url()}: ${e.message}`));
    for (const r of ['/', '/library?tab=albums', `/playlist/${pl.id}`]) {
      await m.goto(B + r, { waitUntil: 'networkidle' });
      await m.waitForTimeout(800);
      await m.screenshot({ path: `${SHOTS}/tablet-${r.replace(/[^a-z]+/gi, '_')}.png` });
    }
    await c2.close();
  }
  const phone = await browser.newContext({ ...(devices['iPhone 15'] ?? devices['iPhone 13']) });
  await phone.addCookies(cookies);
  const m = await phone.newPage();
  m.on('pageerror', (e) => errors.push(`pageerror(phone) ${m.url()}: ${e.message}`));
  const pshot = (n) => m.screenshot({ path: `${SHOTS}/phone-${n}.png` });
  await m.goto(B + '/', { waitUntil: 'networkidle' });
  await m.waitForTimeout(800);
  await pshot('home');
  // tab bar navigation
  const tabs = ['Search', 'Library', 'Downloads', 'Home'];
  let tabsOk = true;
  for (const t of tabs) {
    await m.locator(`nav[aria-label="Primary"] >> text=${t}`).tap();
    await m.waitForTimeout(700);
    const cur = await m.locator('nav[aria-label="Primary"] a[aria-current="page"]').textContent().catch(() => '');
    if (!cur?.includes(t)) tabsOk = false;
  }
  await m.locator('a[aria-label="Profile and settings"]').tap();
  await m.waitForURL(/\/settings/);
  check('phone: tab bar + avatar reach Home/Search/Library/Downloads/Settings', tabsOk);
  // tap a row to play → mini player
  await m.goto(B + '/library?tab=albums', { waitUntil: 'networkidle' });
  await m.locator('a[href^="/album/"]:has-text("Midnight Coastline")').first().tap();
  await m.waitForLoadState('networkidle');
  await m.waitForTimeout(600);
  await pshot('album');
  await m.locator('[role="row"]').first().tap();
  await m.waitForSelector('[aria-label^="Now playing:"]', { timeout: 15000 });
  check('phone: tapping a row plays and shows the mini player', true);
  // nothing hidden behind the dock (long list)
  await m.goto(B + '/library?tab=songs', { waitUntil: 'networkidle' });
  await m.waitForTimeout(800);
  await m.evaluate(() => document.getElementById('main-scroll')?.scrollTo({ top: 1e6 }));
  await m.waitForTimeout(500);
  const lastRow = await m.locator('[role="row"]').last().boundingBox();
  const dockTop = await m.locator('[aria-label^="Now playing:"]').boundingBox();
  check('phone: last row clears the mini player + tab bar', !!lastRow && !!dockTop && lastRow.y + lastRow.height <= dockTop.y + 1, `${lastRow && Math.round(lastRow.y + lastRow.height)} <= ${dockTop && Math.round(dockTop.y)}`);
  await m.goBack({ waitUntil: 'networkidle' });
  await m.waitForTimeout(600);
  // long-press → action sheet → add to playlist
  const row = m.locator('[role="row"]').nth(1);
  const bb = await row.boundingBox();
  const ev = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: bb.x + bb.width / 2, clientY: bb.y + bb.height / 2 };
  await row.dispatchEvent('pointerdown', ev);
  await m.waitForTimeout(650);
  await row.dispatchEvent('pointerup', ev);
  const sheetOpen = await m.locator('[role="menu"] >> text=Add to playlist').isVisible().catch(() => false);
  check('phone: long-press opens the action sheet', sheetOpen);
  await pshot('sheet');
  if (sheetOpen) {
    await m.locator('[role="menu"] >> text=Add to playlist').tap();
    await m.locator('[role="menu"] >> text=E2E Mix').tap();
    await m.waitForSelector('text=/to “E2E Mix”|Already in “E2E Mix”/', { timeout: 10000 });
    check('phone: add to playlist from the sheet', true);
  }
  await m.waitForTimeout(800);
  // full player open/close
  await m.locator('[aria-label^="Now playing:"]').tap();
  await m.waitForSelector('[role="dialog"][aria-label="Now playing"]');
  await m.waitForTimeout(800);
  await pshot('player');
  await m.getByRole('button', { name: 'Up next' }).tap();
  await m.waitForTimeout(800);
  await pshot('player-queue');
  await m.keyboard.press('Escape');
  await m.waitForTimeout(600);
  const stillOpen = (await m.locator('[role="dialog"][aria-label="Now playing"]').count()) > 0;
  check('phone: Escape closes the sheet but keeps the player', stillOpen);
  if (stillOpen) await m.locator('button[aria-label="Close player"]').tap();
  await m.waitForTimeout(500);
  check('phone: full player opens and closes', (await m.locator('[role="dialog"][aria-label="Now playing"]').count()) === 0);
  for (const r of ['/search?q=neon', '/library', '/sources', '/settings', '/downloads', `/playlist/${pl.id}`]) {
    await m.goto(B + r, { waitUntil: 'networkidle' });
    await m.waitForTimeout(800);
    await pshot(r.replace(/[^a-z]+/gi, '_'));
  }
  // light theme sample
  await m.evaluate(() => fetch('/api/me/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'light' }) }));
  for (const r of ['/', `/playlist/${pl.id}`]) {
    await m.goto(B + r, { waitUntil: 'networkidle' });
    await m.waitForTimeout(800);
    await pshot('light' + r.replace(/[^a-z]+/gi, '_'));
  }
  await m.evaluate(() => fetch('/api/me/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'dark' }) }));
  await phone.close();
  check('tablet + phone layouts render', true);

  // 15. Live folder: new songs appear on their own, deletions disappear, an unplugged drive keeps its songs
  {
    const api = (u, o) => p.evaluate(([u, o]) => fetch(u, o).then((r) => r.json()), [u, o]);
    const libCount = async () => (await api('/api/library/tracks?limit=500')).total;
    const folderSrc = async () => (await api('/api/sources')).find((x) => x.type === 'folder');
    const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await p.waitForTimeout(500); } };
    // (the fixture server already serves these songs, so count the folder's own songs rather than the merged library)
    const folderCount = async () => { const f = await folderSrc(); return f?.status === 'syncing' ? -1 : f?.trackCount ?? 0; };
    const before = await folderCount();
    fs.cpSync(path.resolve('fixtures/out/library/Paper Kites Club'), path.join(MUSIC, 'Paper Kites Club'), { recursive: true });
    const t0 = Date.now();
    const grew = await until(async () => (await folderCount()) > before);
    check('new songs in the folder appear by themselves', !!grew, `${before} → ${await folderCount()} in ${Date.now() - t0} ms`);
    const mid = await folderCount();
    fs.rmSync(path.join(MUSIC, 'Paper Kites Club'), { recursive: true });
    const shrank = await until(async () => { const c = await folderCount(); return c >= 0 && c < mid; });
    check('deleted songs disappear by themselves', !!shrank, `${mid} → ${await folderCount()}`);
    fs.renameSync(MUSIC, MUSIC + '-unplugged');
    const off = await until(async () => (await folderSrc())?.status === 'offline', 45000);
    const kept = (await api('/api/library/tracks?limit=500')).tracks.filter((t) => t.offline).length;
    await p.goto(B + '/sources', { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${SHOTS}/drive-unplugged.png` });
    check('unplugged drive: songs kept, marked not connected', !!off && kept > 0 && (await p.locator('text=Not connected').count()) > 0, `${kept} songs flagged`);
    fs.renameSync(MUSIC + '-unplugged', MUSIC);
    const back = await until(async () => { const s2 = await folderSrc(); return s2?.status === 'ok' && (await api('/api/library/tracks?limit=500')).tracks.every((t) => !t.offline); }, 60000);
    check('drive plugged back in reconnects by itself', !!back);
  }

  // 16. Phone setup panel
  {
    const ph = await browser.newContext({ ...(devices['iPhone 15'] ?? devices['iPhone 13']) });
    await ph.addCookies(await ctx.cookies());
    const m2 = await ph.newPage();
    await m2.goto(B + '/settings#use-it-on-your-phone', { waitUntil: 'networkidle' });
    await m2.locator('[data-testid="phone-panel"]').scrollIntoViewIfNeeded();
    await m2.waitForTimeout(800);
    await m2.screenshot({ path: `${SHOTS}/phone-settings-phone-panel.png` });
    await m2.waitForFunction(() => [...document.querySelectorAll('[data-testid="phone-panel"] img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
    const qrOk = await m2.evaluate(() => [...document.querySelectorAll('[data-testid="phone-panel"] img')].some((i) => i.complete && i.naturalWidth > 0));
    const addr = await m2.getByText(/http:\/\/\d+\.\d+\.\d+\.\d+:\d+/).count();
    check('settings shows phone address + QR', addr > 0 && qrOk, `addresses ${addr}, qr ${qrOk}`);
    await m2.goto(B + '/setup', { waitUntil: 'networkidle' });
    await m2.waitForTimeout(600);
    await m2.screenshot({ path: `${SHOTS}/phone-setup.png` });
    await m2.click('text=Folders on this computer or a drive');
    await m2.waitForTimeout(800);
    await m2.screenshot({ path: `${SHOTS}/phone-folder-picker.png` });
    await ph.close();
  }

  check('no page/console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(2);
});
