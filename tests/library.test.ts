import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crumbs, parentOf, windowsDrives, countAudio } from '@/lib/server/fsbrowse';
import { relevantChange } from '@/lib/server/watch';
import { uploadKey } from '@/lib/server/upload-key';
import { walkDir, DriveMissingError } from '@/lib/server/sources/adapters';

describe('folder picker paths', () => {
  it('breadcrumbs for Windows paths', () => {
    expect(crumbs('D:\\Music\\Rock', path.win32)).toEqual([
      { name: 'D:', path: 'D:\\' },
      { name: 'Music', path: 'D:\\Music' },
      { name: 'Rock', path: 'D:\\Music\\Rock' },
    ]);
    expect(crumbs('C:\\', path.win32)).toEqual([{ name: 'C:', path: 'C:\\' }]);
  });
  it('breadcrumbs for POSIX paths', () => {
    expect(crumbs('/media/usb/Music', path.posix).map((c) => c.path)).toEqual(['/', '/media', '/media/usb', '/media/usb/Music']);
  });
  it('parent stops at the drive root', () => {
    expect(parentOf('D:\\Music', path.win32)).toBe('D:\\');
    expect(parentOf('D:\\', path.win32)).toBeNull();
    expect(parentOf('/', path.posix)).toBeNull();
  });
  it('lists drive letters, C: first', () => {
    const present = new Set(['C:\\', 'E:\\', 'A:\\']);
    expect(windowsDrives((p) => present.has(p))).toEqual(['C:\\', 'E:\\', 'A:\\']);
  });
  it('counts audio below a folder', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aur-count-'));
    fs.mkdirSync(path.join(d, 'Album'));
    for (const f of ['Album/01.mp3', 'Album/02.flac', 'Album/cover.jpg', 'notes.txt', '.hidden.mp3']) fs.writeFileSync(path.join(d, f), 'x');
    expect(countAudio(d)).toEqual({ count: 2, capped: false });
  });
});

describe('folder watching', () => {
  it('reacts to audio, artwork and folders but not temp files', () => {
    expect(relevantChange('Artist/Album/01 Song.flac')).toBe(true);
    expect(relevantChange('Artist\\Album\\cover.jpg')).toBe(true);
    expect(relevantChange('Artist/New Album')).toBe(true);
    expect(relevantChange(null)).toBe(true);
    expect(relevantChange('song.mp3.crdownload')).toBe(false);
    expect(relevantChange('Album/.DS_Store')).toBe(false);
    expect(relevantChange('desktop.ini')).toBe(false);
    expect(relevantChange('~$temp.mp3')).toBe(false);
  });
});

describe('scanning', () => {
  it('yields size and mtime and throws DriveMissingError when the root disappears', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aur-walk-'));
    fs.writeFileSync(path.join(d, 'a.mp3'), 'abc');
    const out = [];
    for await (const f of walkDir(d, d, () => true, new AbortController().signal)) out.push(f);
    expect(out).toHaveLength(1);
    expect(out[0].size).toBe(3);
    expect(out[0].mtime).toBeGreaterThan(0);
    const gone = path.join(d, 'unplugged');
    await expect(async () => {
      for await (const _ of walkDir(gone, gone, () => true, new AbortController().signal)) void _;
    }).rejects.toBeInstanceOf(DriveMissingError);
  });
});

describe('upload de-duplication', () => {
  it('matches the server-side file name sanitising, case-insensitively', () => {
    expect(uploadKey('My Music/Daniel Caesar - Best Part.mp3')).toBe('daniel caesar - best part.mp3');
    expect(uploadKey('a:b?.flac')).toBe(uploadKey('A_B_.FLAC'));
  });
});
