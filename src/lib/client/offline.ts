'use client';

import type { Track } from '../types';

/** Minimal IndexedDB wrapper for offline audio + metadata. */
const DB_NAME = 'aurora-offline';
const STORE = 'tracks';

export interface OfflineEntry {
  id: string;
  track: Track;
  blob: Blob;
  art?: Blob | null;
  size: number;
  savedAt: number;
  quality: 'best' | 'smallest';
}

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Offline storage is not available in this browser.'));
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export const offlineDb = {
  put: (e: OfflineEntry) => tx('readwrite', (s) => s.put(e)),
  get: (id: string) => tx<OfflineEntry | undefined>('readonly', (s) => s.get(id) as IDBRequest<OfflineEntry | undefined>),
  delete: (id: string) => tx('readwrite', (s) => s.delete(id)),
  clear: () => tx('readwrite', (s) => s.clear()),
  /** Metadata only (no blobs) for listing. */
  async list(): Promise<Omit<OfflineEntry, 'blob' | 'art'>[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out: Omit<OfflineEntry, 'blob' | 'art'>[] = [];
      const t = db.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        const { blob: _b, art: _a, ...meta } = c.value as OfflineEntry;
        out.push(meta);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },
  async keys(): Promise<string[]> {
    return tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => k.map(String));
  },
};

const urlCache = new Map<string, string>();
export async function offlineUrl(id: string): Promise<string | null> {
  if (urlCache.has(id)) return urlCache.get(id)!;
  try {
    const e = await offlineDb.get(id);
    if (!e) return null;
    const u = URL.createObjectURL(e.blob);
    urlCache.set(id, u);
    return u;
  } catch {
    return null;
  }
}
export function revokeOffline(id: string) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}
