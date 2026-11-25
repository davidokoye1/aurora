'use client';

import { create } from 'zustand';
import type { Track } from '@/lib/types';
import { offlineDb, revokeOffline } from '@/lib/client/offline';
import { toast } from './ui';

/** A track can play if a copy is reachable now, or it's downloaded to this device. */
export function canPlay(t: Track): boolean {
  return t.playable && (!t.offline || useDownloads.getState().saved.has(t.id));
}

export interface DownloadJob {
  trackId: string;
  track: Track;
  status: 'queued' | 'downloading' | 'paused' | 'error' | 'done';
  received: number;
  total: number;
  error?: string;
}

interface DLState {
  jobs: Record<string, DownloadJob>;
  saved: Set<string>;
  loaded: boolean;
  quality: 'best' | 'smallest';
  refresh: () => Promise<void>;
  enqueue: (tracks: Track[]) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (ids: string[]) => Promise<void>;
  removeAll: () => Promise<void>;
  setQuality: (q: 'best' | 'smallest') => void;
}

const controllers = new Map<string, AbortController>();
const CONCURRENCY = 2;

export const useDownloads = create<DLState>((set, get) => {
  const pump = () => {
    const jobs = Object.values(get().jobs);
    const active = jobs.filter((j) => j.status === 'downloading').length;
    const next = jobs.filter((j) => j.status === 'queued').slice(0, Math.max(0, CONCURRENCY - active));
    for (const j of next) void run(j.trackId);
  };
  const patch = (id: string, p: Partial<DownloadJob>) => set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...p } } } : {}));

  const run = async (id: string) => {
    const job = get().jobs[id];
    if (!job) return;
    const ctl = new AbortController();
    controllers.set(id, ctl);
    patch(id, { status: 'downloading', received: 0, error: undefined });
    try {
      const res = await fetch(`/api/stream/${encodeURIComponent(id)}${get().quality === 'smallest' ? '?q=smallest' : ''}`, { signal: ctl.signal, credentials: 'same-origin' });
      if (!res.ok || !res.body) throw new Error(res.status === 502 ? 'Source unreachable' : `HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') ?? 0);
      patch(id, { total });
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastUpdate = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (Date.now() - lastUpdate > 150) {
          lastUpdate = Date.now();
          patch(id, { received });
        }
      }
      const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? 'audio/mpeg' });
      let art: Blob | null = null;
      if (job.track.cover) {
        try {
          const r = await fetch(job.track.cover);
          if (r.ok) art = await r.blob();
        } catch {}
      }
      await offlineDb.put({ id, track: job.track, blob, art, size: blob.size, savedAt: Date.now(), quality: get().quality });
      // warm the service-worker cache with the cover image
      set((s) => {
        const saved = new Set(s.saved);
        saved.add(id);
        const { [id]: _done, ...rest } = s.jobs;
        return { saved, jobs: rest };
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      patch(id, { status: 'error', error: (e as Error).message });
    } finally {
      controllers.delete(id);
      pump();
    }
  };

  return {
    jobs: {},
    saved: new Set(),
    loaded: false,
    quality: 'best',
    refresh: async () => {
      try {
        const keys = await offlineDb.keys();
        set({ saved: new Set(keys), loaded: true });
      } catch {
        set({ loaded: true });
      }
    },
    enqueue: (tracks) => {
      const s = get();
      const add = tracks.filter((t) => t.playable && !t.offline && !s.saved.has(t.id) && !s.jobs[t.id]);
      if (!add.length) {
        const offline = tracks.filter((t) => t.offline || !t.playable).length;
        toast.info(offline === tracks.length ? 'These songs aren’t reachable right now — is the drive they live on plugged in?' : tracks.length === 1 ? 'Already downloaded.' : 'These songs are already downloaded.');
        return;
      }
      void navigator.storage?.persist?.().catch(() => {});
      set((st) => ({ jobs: { ...st.jobs, ...Object.fromEntries(add.map((t) => [t.id, { trackId: t.id, track: t, status: 'queued' as const, received: 0, total: 0 }])) } }));
      toast.success(add.length === 1 ? `Downloading “${add[0].title}”` : `Downloading ${add.length} songs`);
      pump();
    },
    pause: (id) => {
      controllers.get(id)?.abort();
      patch(id, { status: 'paused', received: 0 });
      pump();
    },
    resume: (id) => {
      patch(id, { status: 'queued' });
      pump();
    },
    cancel: (id) => {
      controllers.get(id)?.abort();
      set((s) => {
        const { [id]: _x, ...rest } = s.jobs;
        return { jobs: rest };
      });
      pump();
    },
    remove: async (ids) => {
      for (const id of ids) {
        await offlineDb.delete(id).catch(() => {});
        revokeOffline(id);
      }
      set((s) => {
        const saved = new Set(s.saved);
        ids.forEach((i) => saved.delete(i));
        return { saved };
      });
    },
    removeAll: async () => {
      for (const id of get().saved) revokeOffline(id);
      await offlineDb.clear().catch(() => {});
      set({ saved: new Set() });
    },
    setQuality: (q) => set({ quality: q }),
  };
});
