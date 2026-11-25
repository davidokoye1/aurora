import 'server-only';
import yauzl from 'yauzl';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { HttpClient } from '../net';
import { CACHE_DIR } from '../db';
import { AUDIO_EXT, extOf } from './media';

/** Random access over HTTP Range requests, so zip central directories can be read without downloading the archive. */
class HttpReader extends yauzl.RandomAccessReader {
  constructor(private client: HttpClient, private url: string) {
    super();
  }
  _readStreamForRange(start: number, end: number) {
    const out = new PassThrough();
    this.client
      .request(this.url, { headers: { range: `bytes=${start}-${end - 1}` } })
      .then((r) => {
        if (r.status !== 206) {
          out.destroy(new Error('Server does not support range requests for this archive'));
          r.body?.cancel().catch(() => {});
          return;
        }
        Readable.fromWeb(r.body as never).pipe(out);
      })
      .catch((e) => out.destroy(e));
    return out;
  }
}

export interface ZipEntryInfo {
  name: string;
  size: number;
}

function openZip(client: HttpClient, url: string, total: number): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    const reader = new HttpReader(client, url);
    yauzl.fromRandomAccessReader(reader, total, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: false }, (err, zf) =>
      err ? reject(err) : resolve(zf!),
    );
  });
}

async function zipLocalCopy(client: HttpClient, url: string): Promise<string> {
  const file = path.join(CACHE_DIR, 'zip-' + crypto.createHash('sha1').update(url).digest('hex') + '.zip');
  if (fs.existsSync(file)) return file;
  const r = await client.request(url);
  if (r.status >= 400 || !r.body) throw new Error(`HTTP ${r.status} downloading archive`);
  const tmp = file + '.part';
  await pipeline(Readable.fromWeb(r.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
  return file;
}

async function withZip<T>(client: HttpClient, url: string, fn: (zf: yauzl.ZipFile) => Promise<T>): Promise<T> {
  const head = await client.head(url, 2);
  let zf: yauzl.ZipFile;
  if (head.ranged && head.total) zf = await openZip(client, url, head.total);
  else {
    const file = await zipLocalCopy(client, url);
    zf = await new Promise<yauzl.ZipFile>((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e ? rej(e) : res(z!))));
  }
  try {
    return await fn(zf);
  } finally {
    zf.close();
  }
}

export async function listZip(client: HttpClient, url: string): Promise<ZipEntryInfo[]> {
  return withZip(client, url, (zf) =>
    new Promise<ZipEntryInfo[]>((resolve, reject) => {
      const out: ZipEntryInfo[] = [];
      zf.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('/') && AUDIO_EXT[extOf(e.fileName)] && !e.fileName.includes('__MACOSX')) out.push({ name: e.fileName, size: e.uncompressedSize });
        zf.readEntry();
      });
      zf.on('end', () => resolve(out));
      zf.on('error', reject);
      zf.readEntry();
    }),
  );
}

const extracting = new Map<string, Promise<string>>();

/** Extract a single zip entry into the cache (once) and return the local file path. */
export function extractZipEntry(client: HttpClient, url: string, entry: string): Promise<string> {
  const key = crypto.createHash('sha1').update(url + '#' + entry).digest('hex');
  const file = path.join(CACHE_DIR, `ze-${key}.${extOf(entry) || 'bin'}`);
  if (fs.existsSync(file)) return Promise.resolve(file);
  const existing = extracting.get(key);
  if (existing) return existing;
  const p = withZip(client, url, (zf) =>
    new Promise<string>((resolve, reject) => {
      let found = false;
      zf.on('entry', (e: yauzl.Entry) => {
        if (e.fileName !== entry) return zf.readEntry();
        found = true;
        zf.openReadStream(e, (err, rs) => {
          if (err || !rs) return reject(err ?? new Error('Cannot read entry'));
          const tmp = file + '.part';
          pipeline(rs, fs.createWriteStream(tmp))
            .then(() => {
              fs.renameSync(tmp, file);
              resolve(file);
            })
            .catch(reject);
        });
      });
      zf.on('end', () => !found && reject(new Error('Entry not found in archive')));
      zf.on('error', reject);
      zf.readEntry();
    }),
  ).finally(() => extracting.delete(key));
  extracting.set(key, p);
  return p;
}
