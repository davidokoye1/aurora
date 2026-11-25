#!/usr/bin/env node
/**
 * Generates a small synthetic music library for testing every importer path.
 * Requires ffmpeg. Output: fixtures/out/library (+ zip, playlists, feed, manifest).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'fixtures/out');
const LIB = path.join(ROOT, 'library');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(LIB, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

// Flat, poster-style test covers in a warm palette (one colour field + simple ink/paper shapes)
const COLORS = ['0xff5b2e', '0xd9a23c', '0x7f8f4e', '0x5b7080', '0xc4716a', '0x3f5d8f', '0x9a6a4f', '0x2f7d6d'];
const SHAPES = [
  'drawbox=x=0:y=300:w=480:h=70:color=0x111010:t=fill,drawbox=x=60:y=60:w=140:h=140:color=0xf3efe8:t=fill',
  'drawbox=x=300:y=0:w=60:h=480:color=0x111010:t=fill,drawbox=x=60:y=330:w=180:h=90:color=0xf3efe8:t=fill',
  'drawbox=x=40:y=40:w=400:h=400:color=0x111010:t=18,drawbox=x=200:y=200:w=80:h=80:color=0x111010:t=fill',
  'drawbox=x=0:y=0:w=480:h=160:color=0x111010:t=fill,drawbox=x=300:y=260:w=120:h=120:color=0xf3efe8:t=fill',
  'drawbox=x=60:y=60:w=360:h=40:color=0x111010:t=fill,drawbox=x=60:y=140:w=240:h=40:color=0x111010:t=fill,drawbox=x=60:y=220:w=300:h=40:color=0x111010:t=fill',
];
let colorIdx = 0;
function cover(file) {
  const c = COLORS[colorIdx % COLORS.length];
  const shape = SHAPES[colorIdx % SHAPES.length];
  colorIdx++;
  ff(['-f', 'lavfi', '-i', `color=c=${c}:s=480x480,format=rgb24,${shape}`, '-frames:v', '1', '-q:v', '3', file]);
  return file;
}

/** Synth a "song": a chord with amplitude pulses at the given BPM. Energy ~ pulse depth + brightness. */
function synth(file, { secs, bpm, base, bright, tags = {}, art, codec }) {
  const beat = bpm / 60;
  const expr = `(0.35*sin(2*PI*${base}*t)+0.25*sin(2*PI*${base * 1.25}*t)+0.2*sin(2*PI*${base * 1.5}*t)+${bright}*0.2*sin(2*PI*${base * 8}*t))*(0.35+0.65*pow(abs(sin(PI*${beat}*t)),6))`;
  const args = ['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${secs}`];
  if (art) args.push('-i', art);
  args.push('-map', '0:a');
  if (art) args.push('-map', '1:v', '-c:v', codec === 'm4a' ? 'mjpeg' : 'mjpeg', '-disposition:v', 'attached_pic');
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`);
  if (codec === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3');
  else if (codec === 'flac') args.push('-c:a', 'flac');
  else if (codec === 'm4a') args.push('-c:a', 'aac', '-b:a', '128k');
  else if (codec === 'ogg') args.push('-c:a', 'libvorbis', '-q:a', '3');
  else if (codec === 'opus') args.push('-c:a', 'libopus', '-b:a', '96k');
  args.push(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ff(args);
}

const CATALOG = [
  { artist: 'Neon Harbor', genre: 'Synthwave', year: 2021, album: 'Midnight Coastline', bpm: 100, base: 196, bright: 0.4, codec: 'mp3', titles: ['Afterglow Drive', 'Chrome Skyline', 'Satellite Hearts'] },
  { artist: 'Neon Harbor', genre: 'Synthwave', year: 2023, album: 'Night Signals', bpm: 108, base: 220, bright: 0.5, codec: 'flac', titles: ['Signal Fire', 'Low Orbit'] },
  { artist: 'The Quiet Fields', genre: 'Folk', year: 2018, album: 'Barley & Light', bpm: 84, base: 262, bright: 0.2, codec: 'm4a', titles: ['Morning Lantern', 'River Hymn', 'Slow Harvest'] },
  { artist: 'Kinetic Youth', genre: 'Drum and Bass', year: 2024, album: 'Pressure Systems', bpm: 172, base: 110, bright: 0.9, codec: 'mp3', titles: ['Breakline', 'Overclock', 'Static Rush'] },
  { artist: 'Mara Velvet', genre: 'R&B', year: 2020, album: 'Silk Hours', bpm: 92, base: 233, bright: 0.3, codec: 'ogg', titles: ['Velvet Room', 'Slow Burn'] },
  { artist: 'Lumen Ensemble', genre: 'Ambient', year: 2016, album: 'Tidal Rooms', bpm: 60, base: 174, bright: 0.1, codec: 'flac', titles: ['Breathing Glass', 'Undertow'] },
];

const manifest = { name: 'Fixture Manifest', albums: [] };
for (const a of CATALOG) {
  const dir = path.join(LIB, a.artist, `${a.album} (${a.year})`);
  fs.mkdirSync(dir, { recursive: true });
  const art = cover(path.join(dir, 'cover.jpg'));
  const mAlbum = { title: a.album, artist: a.artist, year: a.year, cover: `library/${encodeURI(a.artist)}/${encodeURI(`${a.album} (${a.year})`)}/cover.jpg`, tracks: [] };
  a.titles.forEach((title, i) => {
    const n = String(i + 1).padStart(2, '0');
    const ext = a.codec;
    const file = path.join(dir, `${n} - ${title}.${ext}`);
    synth(file, {
      secs: 24 + i * 6,
      bpm: a.bpm + i * 2,
      base: a.base * (1 + i * 0.06),
      bright: a.bright,
      art: ext === 'ogg' ? undefined : art,
      codec: ext,
      tags: { title, artist: a.artist, album_artist: a.artist, album: a.album, track: `${i + 1}/${a.titles.length}`, date: String(a.year), genre: a.genre },
    });
    mAlbum.tracks.push({ title, url: `library/${encodeURI(a.artist)}/${encodeURI(`${a.album} (${a.year})`)}/${encodeURI(`${n} - ${title}.${ext}`)}` });
  });
  manifest.albums.push(mAlbum);
}

// Untagged files: metadata must come from folder/file names
synth(path.join(LIB, 'Paper Kites Club', 'Window Seat [2019]', '01 - Rain on Glass.mp3'), { secs: 20, bpm: 76, base: 247, bright: 0.2, codec: 'mp3' });
synth(path.join(LIB, 'Paper Kites Club', 'Window Seat [2019]', 'CD2', '02 - Tram Lines.mp3'), { secs: 20, bpm: 80, base: 262, bright: 0.25, codec: 'mp3' });
// Unicode / accented names
synth(path.join(LIB, 'Sigur Ósk', 'Ágætis Dagur (2012)', '01 - Svefn í Snjó.mp3'), { secs: 22, bpm: 70, base: 196, bright: 0.15, codec: 'mp3', tags: { title: 'Svefn í Snjó', artist: 'Sigur Ósk', album: 'Ágætis Dagur', date: '2012', genre: 'Post-Rock' } });
// Opus file
synth(path.join(LIB, 'Kinetic Youth', 'Singles', 'Voltage (Edit).opus'), { secs: 18, bpm: 174, base: 123, bright: 0.9, codec: 'opus', tags: { title: 'Voltage (Edit)', artist: 'Kinetic Youth', genre: 'Drum and Bass', date: '2025' } });

// Zip album
const zipDir = path.join(ROOT, 'zipsrc', 'Glass Animals Club - Zip Sessions (2022)');
fs.mkdirSync(zipDir, { recursive: true });
synth(path.join(zipDir, '01 - Zipped Groove.mp3'), { secs: 20, bpm: 118, base: 220, bright: 0.6, codec: 'mp3', tags: { title: 'Zipped Groove', artist: 'Glass Animals Club', album: 'Zip Sessions', date: '2022', genre: 'Indie' } });
synth(path.join(zipDir, '02 - Compressed Air.mp3'), { secs: 20, bpm: 122, base: 247, bright: 0.6, codec: 'mp3', tags: { title: 'Compressed Air', artist: 'Glass Animals Club', album: 'Zip Sessions', date: '2022', genre: 'Indie' } });
execFileSync('zip', ['-r', '-0', '-q', path.join(ROOT, 'album.zip'), '.'], { cwd: path.join(ROOT, 'zipsrc') });

// Playlist files (relative paths)
const mp3s = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mp3|flac|m4a|ogg|opus)$/.test(e.name)) mp3s.push(path.relative(ROOT, p));
  }
};
walk(LIB);
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
fs.writeFileSync(path.join(ROOT, 'playlist.m3u'), ['#EXTM3U', '#PLAYLIST:Fixture Mixtape', ...mp3s.slice(0, 6).flatMap((p) => [`#EXTINF:30,${path.basename(path.dirname(path.dirname(p)))} - ${path.basename(p).replace(/^\d+ - |\.\w+$/g, '')}`, enc(p)])].join('\n'));
fs.writeFileSync(path.join(ROOT, 'playlist.pls'), ['[playlist]', ...mp3s.slice(0, 3).flatMap((p, i) => [`File${i + 1}=${enc(p)}`, `Title${i + 1}=${path.basename(p).replace(/\.\w+$/, '')}`, `Length${i + 1}=30`]), `NumberOfEntries=3`, 'Version=2'].join('\n'));
fs.writeFileSync(
  path.join(ROOT, 'playlist.xspf'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/"><title>XSPF Picks</title><trackList>${mp3s
    .slice(2, 5)
    .map((p) => `<track><location>${enc(p)}</location><title>${path.basename(p).replace(/^\d+ - |\.\w+$/g, '')}</title><creator>Fixture</creator></track>`)
    .join('')}</trackList></playlist>`,
);
fs.writeFileSync(
  path.join(ROOT, 'feed.xml'),
  `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Fixture Radio Hour</title><itunes:author>Aurora QA</itunes:author>${mp3s
    .slice(0, 3)
    .map((p, i) => `<item><title>Episode ${i + 1}</title><enclosure url="${enc(p)}" type="audio/mpeg" length="1000"/><itunes:duration>00:30</itunes:duration><pubDate>Mon, 0${i + 1} Jan 2024 10:00:00 GMT</pubDate></item>`)
    .join('')}</channel></rss>`,
);
manifest.playlists = [{ name: 'Manifest Favourites', tracks: [manifest.albums[0].tracks[0].url, manifest.albums[2].tracks[1].url] }];
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Fixtures written to ${ROOT}: ${mp3s.length} audio files`);
