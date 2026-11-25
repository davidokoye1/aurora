# Aurora

A self-hosted music streaming app for **the music you already own**. Point it at the folders on your computer or an external drive, or upload songs from your phone, then listen on your phone at home or anywhere. Around that it gives you a full streaming-app experience: personalised mixes, radio, synced lyrics, offline downloads, stats and a yearly recap.

## Quick start

### On Windows
1. Install **Node.js 22 or newer** (the "LTS" download from nodejs.org).
2. Unzip Aurora somewhere permanent, e.g. `Documents\Aurora`.
3. Double-click **`Aurora.cmd`**.
   - The first run installs and builds Aurora, which takes a few minutes once.
   - After that it starts in seconds and opens your browser.
4. Create your account (the first one is the admin). Then choose your music folders, an external drive, or both.

Keep the Aurora window open while you listen; closing it stops the server.
- **Start automatically when you sign in:** right-click `scripts\windows\start-on-login.ps1` → *Run with PowerShell*. Run it with `-Remove` to undo.
- **Update after replacing the files:** run `Aurora.cmd update`.

### macOS / Linux

```bash
pnpm install
pnpm build
pnpm start            # prints the address to open on your phone
```

Or with Docker:

```bash
docker compose up -d --build
```

Everything Aurora stores (database, uploads, artwork, caches) lives in `./data`, or in `DATA_DIR` if you set it. Your music folders are only read, never changed.

ffmpeg comes bundled and powers the tempo/energy analysis behind the mood mixes; a system ffmpeg is used if you have one.

| Env var | Purpose |
|---|---|
| `DATA_DIR` | Where data lives (default `./data`) |
| `PORT` | Port to listen on (default 3000) |
| `MUSIC_DIR` | A folder to add automatically when the admin signs up |
| `SESSION_SECRET` | Key for sessions and encrypted source credentials. Generated into `data/secret.key` if unset |
| `ALLOW_SIGNUP=1` | Allow extra accounts (also a toggle in Settings). Closed by default after the first account |
| `COOKIE_SECURE=1/0` | Force the session cookie's Secure flag. By default it follows `X-Forwarded-Proto` |

No accounts with outside services, API keys or subscriptions are needed.

## On your phone

**Settings → Use it on your phone** shows every address below with a QR code; scan it with the phone's camera.

### At home and away (recommended): Tailscale
Tailscale is free and gives your computer a private `https://` address that only your own devices can reach, on any network.
1. Install Tailscale on the computer (tailscale.com/download) and the Tailscale app on your phone. Sign in to both with the same account.
2. On the computer, open a terminal and run `tailscale serve --bg 3000`. If it asks you to enable HTTPS for your tailnet, follow its link and run it again.
3. Open the `https://<your-pc>.<tailnet>.ts.net` address on your phone. Then:
   - **iPhone:** Share → *Add to Home Screen*
   - **Android:** menu → *Install app*

Because the address is HTTPS, you also get the installed full-screen app, lock-screen controls and **offline downloads** for when you have no signal.

### Home Wi-Fi only
Open the `http://192.168.x.x:3000` address that `Aurora.cmd` prints, with the phone on the same Wi-Fi. If the phone can't connect, allow Node.js through Windows Firewall on *Private networks*. Offline downloads and Home Screen install need the HTTPS address above (a browser rule).

### How it works on the phone
- **Tabs:** Home, Search, Library and Downloads along the bottom, with the mini player docked above them.
- **Mini player:** swipe left/right to skip, swipe up (or tap) to open the full player.
- **Full player:** swipe the artwork to change track, drag down to close. Lyrics, Up next and EQ open as sheets.
- **Song actions:** tap ⋯ or long-press any song for its action sheet: play next, add to playlist, like, download, radio and more.

## Adding music

Open **Music Sources** (or the *Add your music* screen on first run).

- **Folders and drives** (admin)
  - Browse to the folder that holds your music: your Music folder, Downloads, OneDrive, or an external drive/USB stick. Sub-folders are included, and tags and artwork are read automatically.
  - **Folders stay in sync by themselves:** drop new songs in and they appear within seconds; delete them and they disappear.
  - **Re-scans are fast:** unchanged files are skipped, so 10,000 songs re-scan in about 1.5 seconds.
  - **External drives can come and go.** When a drive is unplugged its songs stay in your library, marked *Drive not connected*. They're skipped in the queue unless you've downloaded them to your phone, and everything reconnects by itself when you plug the drive back in.
- **Upload files** from your phone or any device.
  - On iPhone, pick songs from the Files app. Songs from Apple Music are copy-protected and can't be added.
  - Songs you've already uploaded are skipped, so re-uploading a folder only sends what's new.
- **Network / URL** for music that lives elsewhere on your network:
  Aurora probes the URL, shows you what it found, then imports it in the background. Supported:
  - directory listings (Apache, nginx, Caddy, IIS, lighttpd), crawled recursively; folder names become artist/album, and `cover.jpg`/`folder.jpg` become artwork
  - any web page with audio links: direct links, `<audio>` tags, `download.php?id=` style links (checked by content sniffing), `og:audio`, JSON-LD, URLs inside inline scripts, and paginated listings
  - M3U/M3U8, PLS and XSPF playlists (imported as playlists too)
  - zip archives (listed with range requests; entries extracted on first play)
  - podcast / RSS / Atom feeds
  - JSON manifests (any reasonable shape; see *What URLs work?* on the Sources page)
  - Subsonic-compatible servers (Navidrome, Airsonic, Gonic…) and Jellyfin/Emby, including their playlists
  - Internet Archive item pages (uses archive.org's per-file metadata; alternate formats are merged)

  Per-source access options:
  - Basic auth, custom headers (Cookie / Referer / User-Agent), API key
  - crawl depth, max files, parallel requests, politeness delay
  - include/exclude globs, "Render JavaScript", wide scope

  Credentials are encrypted on the server (AES-GCM) and never sent to the browser. All audio is proxied through Aurora with HTTP Range support, and seeking is emulated for servers that don't support Range. Remote tags are read with ranged requests, so files are never downloaded in full just to be indexed.

  Sites behind CAPTCHAs, anti-bot walls or DRM can't be imported, and Aurora doesn't try to get around them. What you connect is your responsibility.

Metadata enrichment (admin-toggleable) fills in gaps from MusicBrainz, Cover Art Archive, Wikidata/Wikipedia (artist photos and bios) and LRCLIB (synced lyrics). Only names are sent to these services, never your files.

## Features

- **Player**
  - persistent dual-deck engine: gapless preloading, 0–12 s crossfade
  - 10-band EQ with presets, loudness normalisation (ReplayGain or measured loudness), speed 0.5–2×
  - sleep timer; media keys and lock-screen controls (Media Session)
  - mini player, immersive full-screen player with an audio-reactive backdrop, synced lyrics with tap-to-seek
  - queue with drag reorder, play next / add to queue, smart autoplay
- **Discovery**
  - daily mixes, Discover Weekly, On Repeat, Forgotten Favorites, mood and genre pages, artist and song radio
  - built-in natural-language playlist generator ("a late-night drive, no rap, 1 hour")
  - the taste profile learns from completed plays, repeats, skips, likes, playlist adds and follows
- **Library**
  - playlists with drag-and-drop ordering, custom covers, descriptions, share links and collaborators
  - liked songs, saved albums, followed artists, custom collections, podcasts
- **Search**: instant and typo-tolerant across songs, artists, albums, playlists and genres, with suggestions, recent searches, filters and "did you mean".
- **Offline**: download songs, albums or playlists to the browser (IndexedDB) with progress, a manager, storage meter and quality setting. The PWA shell keeps working offline.
- **Insights**: stats (top artists, songs and genres, listening clock, streaks), a story-style yearly recap, private sessions, an explicit filter.
- **Personalisation**: dark/black/light themes, accent colour (or follow the artwork), reorderable home sections, keyboard shortcuts (`?` lists them).

## Development & tests

```bash
pnpm dev                                    # dev server
pnpm test                                   # unit tests (parsers, folder picker paths, watcher, scanning, upload dedupe)
pnpm fixtures && pnpm fixture-server &      # synthetic library served in many shapes on :4100
DATA_DIR=./data-e2e pnpm start &            # (after pnpm build)
pnpm test:e2e                               # browser journeys: import, play, playlists, offline…
```
