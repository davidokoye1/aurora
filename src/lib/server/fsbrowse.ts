import 'server-only';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUDIO_EXT, extOf } from './sources/media';

/** Read-only folder browsing for the "choose your music folder" picker (admin only). */

type PathMod = typeof path.posix;

export interface Place {
  name: string;
  path: string;
  kind: 'music' | 'downloads' | 'desktop' | 'home' | 'cloud' | 'drive' | 'removable';
}

export interface Crumb {
  name: string;
  path: string;
}

/** Breadcrumbs from the root to `p`, e.g. D:\Music\Rock → D:\, Music, Rock. */
export function crumbs(p: string, pm: PathMod = path): Crumb[] {
  const root = pm.parse(p).root;
  const rest = p.slice(root.length).split(/[\\/]+/).filter(Boolean);
  const out: Crumb[] = [{ name: root.replace(/[\\/]+$/, '') || root, path: root }];
  let cur = root;
  for (const seg of rest) {
    cur = pm.join(cur, seg);
    out.push({ name: seg, path: cur });
  }
  return out;
}

/** The parent folder, or null at a drive/filesystem root. */
export function parentOf(p: string, pm: PathMod = path): string | null {
  const parent = pm.dirname(p);
  return parent === p ? null : parent;
}

/** Windows drive roots that exist (C:\ … Z:\). `exists` is injectable for tests. */
export function windowsDrives(exists: (p: string) => boolean = fs.existsSync): string[] {
  const out: string[] = [];
  for (let c = 67; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    if (exists(root)) out.push(root);
  }
  // A: / B: are floppy letters but some USB sticks get them; check last so C: leads
  for (const c of ['A', 'B']) if (exists(`${c}:\\`)) out.push(`${c}:\\`);
  return out;
}

function isHidden(name: string) {
  return name.startsWith('.') || name.startsWith('$') || name === 'System Volume Information' || name === 'node_modules' || name === 'AppData';
}

/** Shortcuts shown before you start browsing: your Music/Downloads folders, cloud folders and drives. */
export function places(): Place[] {
  const home = os.homedir();
  const out: Place[] = [];
  const add = (name: string, p: string, kind: Place['kind']) => {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory() && !out.some((x) => x.path === p)) out.push({ name, path: p, kind });
    } catch {}
  };
  add('Music', path.join(home, 'Music'), 'music');
  add('OneDrive · Music', path.join(home, 'OneDrive', 'Music'), 'cloud');
  add('iTunes Media', path.join(home, 'Music', 'iTunes', 'iTunes Media', 'Music'), 'music');
  add('Downloads', path.join(home, 'Downloads'), 'downloads');
  add('Desktop', path.join(home, 'Desktop'), 'desktop');
  add('OneDrive', path.join(home, 'OneDrive'), 'cloud');
  add('Dropbox', path.join(home, 'Dropbox'), 'cloud');
  add('Google Drive', path.join(home, 'Google Drive'), 'cloud');
  add('Home', home, 'home');
  if (process.platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:') + '\\';
    for (const d of windowsDrives()) add(d.toLowerCase() === sys.toLowerCase() ? `This PC (${d.slice(0, 2)})` : `Drive ${d.slice(0, 2)}`, d, d.toLowerCase() === sys.toLowerCase() ? 'drive' : 'removable');
  } else {
    for (const base of ['/Volumes', '/media', `/media/${os.userInfo().username}`, '/mnt', `/run/media/${os.userInfo().username}`]) {
      try {
        for (const e of fs.readdirSync(base, { withFileTypes: true })) {
          if (e.isDirectory() && !isHidden(e.name) && e.name !== os.userInfo().username) add(e.name, path.join(base, e.name), 'removable');
        }
      } catch {}
    }
    add('Computer', '/', 'drive');
  }
  return out;
}

const SYSTEM_DIRS = new Set(['proc', 'sys', 'dev', 'run', 'boot', 'bin', 'sbin', 'lib', 'lib32', 'lib64', 'libx32', 'etc', 'usr', 'var', 'snap', 'lost+found', 'private', 'System', 'Library', 'cores', 'nix', 'old_root', 'bin.usr-is-merged', 'lib.usr-is-merged', 'sbin.usr-is-merged']);

export interface Listing {
  path: string;
  parent: string | null;
  crumbs: Crumb[];
  dirs: { name: string; path: string }[];
  audioHere: number;
  /** Audio files found in this folder and below (stops counting after a short time budget). */
  audioBelow: number;
  capped: boolean;
}

/** Count audio files under `dir`, giving up after `budgetMs` or `maxEntries` directory entries. */
export function countAudio(dir: string, budgetMs = 400, maxEntries = 20_000): { count: number; capped: boolean } {
  const until = Date.now() + budgetMs;
  let count = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    if (Date.now() > until || seen > maxEntries) return { count, capped: true };
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      seen++;
      if (isHidden(e.name)) continue;
      if (e.isDirectory()) {
        if (!(d === '/' && SYSTEM_DIRS.has(e.name))) stack.push(path.join(d, e.name));
      } else if (AUDIO_EXT[extOf(e.name)]) count++;
    }
  }
  return { count, capped: false };
}

export function list(dir: string): Listing {
  const p = path.resolve(dir);
  const entries = fs.readdirSync(p, { withFileTypes: true });
  const sysRoot = process.platform !== 'win32' && p === '/';
  const dirs = entries
    .filter((e) => e.isDirectory() && !isHidden(e.name) && !(sysRoot && SYSTEM_DIRS.has(e.name)))
    .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const audioHere = entries.filter((e) => e.isFile() && AUDIO_EXT[extOf(e.name)]).length;
  const below = countAudio(p);
  return { path: p, parent: parentOf(p), crumbs: crumbs(p), dirs, audioHere, audioBelow: below.count, capped: below.capped };
}
