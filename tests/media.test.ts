import { describe, it, expect } from 'vitest';
import { parsePath, sniffAudio, extOf } from '@/lib/server/sources/media';

describe('parsePath', () => {
  it('reads artist/album (year)/NN - title', () => {
    expect(parsePath('Neon Harbor/Midnight Coastline (2021)/01 - Afterglow Drive.mp3')).toMatchObject({ artist: 'Neon Harbor', album: 'Midnight Coastline', year: 2021, trackNo: 1, title: 'Afterglow Drive' });
  });
  it('handles disc folders and generic roots', () => {
    expect(parsePath('/library/Paper Kites Club/Window Seat [2019]/CD2/02 - Tram Lines.mp3')).toMatchObject({ artist: 'Paper Kites Club', album: 'Window Seat', year: 2019, discNo: 2, trackNo: 2, title: 'Tram Lines' });
  });
  it('parses "Artist - Album (Year)" folders and artist in filename', () => {
    expect(parsePath('Music/Daft Punk - Discovery (2001)/03. Daft Punk - Digital Love.flac')).toMatchObject({ artist: 'Daft Punk', album: 'Discovery', year: 2001, trackNo: 3, title: 'Digital Love' });
  });
  it('decodes percent-encoding and unicode', () => {
    expect(parsePath('/apache/Sigur%20%C3%93sk/%C3%81g%C3%A6tis%20Dagur%20(2012)/01%20-%20Svefn%20%C3%AD%20Snj%C3%B3.mp3')).toMatchObject({ artist: 'Sigur Ósk', album: 'Ágætis Dagur', title: 'Svefn í Snjó' });
  });
  it('handles disc-track prefixes', () => {
    expect(parsePath('X/Y/1-03 Song Name.mp3')).toMatchObject({ discNo: 1, trackNo: 3, title: 'Song Name' });
  });
  it('bare filename', () => {
    expect(parsePath('Some Artist - Some Song.mp3')).toMatchObject({ artist: 'Some Artist', title: 'Some Song' });
  });
});

describe('sniff', () => {
  it('recognises magic bytes', () => {
    expect(sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]))?.format).toBe('mp3');
    expect(sniffAudio(new TextEncoder().encode('fLaC\0\0\0\0\0\0\0\0'))?.format).toBe('flac');
    expect(sniffAudio(new TextEncoder().encode('OggS\0\0\0\0\0\0\0\0OpusHead'))?.format).toBe('opus');
    expect(sniffAudio(new TextEncoder().encode('\0\0\0\x20ftypM4A \0\0'))?.format).toBe('m4a');
  });
  it('extOf ignores query strings', () => {
    expect(extOf('http://x/a/b.FLAC?token=1')).toBe('flac');
    expect(extOf('http://x/download.php?id=3')).toBe('php');
  });
});

import { inScope, extractPage } from '@/lib/server/sources/html';
describe('crawl scope', () => {
  const root = new URL('https://archive.org/details/Item');
  it('stays on an item page and below it', () => {
    expect(inScope('https://archive.org/details/Item/disc1', root.href, root, false)).toBe(true);
    expect(inScope('https://archive.org/details/Other', root.href, root, false)).toBe(false);
  });
  it('directory roots include sub-folders but not parents or sort links', () => {
    const r = new URL('http://h/music/');
    expect(inScope('http://h/music/Artist/', r.href, r, false)).toBe(true);
    expect(inScope('http://h/', r.href, r, false)).toBe(false);
    expect(inScope('http://h/music/?C=N;O=D', r.href, r, false)).toBe(false);
    expect(inScope('http://h/music/?page=2', r.href, r, false)).toBe(true);
  });
});
describe('extractPage', () => {
  it('finds audio links, download endpoints, og:audio and script URLs', () => {
    const html = `<html><head><meta property="og:audio" content="/a/og.mp3"><title>x</title></head><body>
      <a href="Song%20One.mp3">Song One.mp3</a><a href="download.php?id=4">Track.flac</a><a href="sub/">sub</a>
      <audio src="/b/c.ogg"></audio><script>var p=["https://cdn.x/y/z.m4a"]</script></body></html>`;
    const info = extractPage(html, 'http://h/music/');
    const kinds = Object.fromEntries(info.links.map((l) => [l.url, l.kind]));
    expect(kinds['http://h/music/Song%20One.mp3']).toBe('audio');
    expect(kinds['http://h/music/download.php?id=4']).toBe('probe');
    expect(kinds['http://h/music/sub/']).toBe('page');
    expect(kinds['http://h/a/og.mp3']).toBe('audio');
    expect(kinds['http://h/b/c.ogg']).toBe('audio');
    expect(kinds['https://cdn.x/y/z.m4a']).toBe('audio');
  });
});

describe('filename noise', () => {
  it('strips bitrate/sample-rate tokens and splits glued artist-title', () => {
    expect(parsePath('Free 20s Jazz/Eubie Blake-Charleston Rag 11KHz 64kb.mp3')).toMatchObject({ artist: 'Eubie Blake', title: 'Charleston Rag' });
    expect(parsePath('x/HoldMe_64kb.mp3').title).toBe('HoldMe');
    expect(parsePath('x/Spider-Man.mp3').title).toBe('Spider-Man');
  });
});

import { stemOf } from '@/lib/server/catalog';
describe('stemOf', () => {
  it('groups alternate encodings', () => {
    expect(stemOf('https://a/x/2to2.mp3')).toBe(stemOf('https://a/x/2to2_64kb.mp3'));
    expect(stemOf('https://a/x/2to2.ogg')).toBe('https://a/x/2to2');
    expect(stemOf('/local/file.mp3')).toBeNull();
    expect(stemOf('https://a/dl.php?id=1')).toBeNull();
  });
});
