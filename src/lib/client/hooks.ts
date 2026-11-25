'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, createContext, useContext } from 'react';
import { api } from './api';
import type { Me, Playlist, Track, UserSettings } from '../types';
import { toast } from '@/stores/ui';
import { usePlayer } from '@/stores/player';

export const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  const initial = useContext(MeContext);
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), initialData: initial ?? undefined, staleTime: 60_000 });
  return (data ?? initial)!;
}

export function useSettings() {
  const me = useMe();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api<UserSettings>('/api/me/settings', { method: 'PUT', body: patch }),
    onMutate: (patch) => {
      const prev = qc.getQueryData<Me>(['me']);
      if (prev) qc.setQueryData<Me>(['me'], { ...prev, settings: { ...prev.settings, ...patch } });
      return { prev };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['me'], ctx.prev);
      toast.error((e as Error).message);
    },
    onSuccess: (settings) => {
      const prev = qc.getQueryData<Me>(['me']);
      if (prev) qc.setQueryData<Me>(['me'], { ...prev, settings });
    },
  });
  return { settings: me.settings, update: m.mutate };
}

/** Patch a track everywhere it appears in the React Query cache + player queue. */
export function patchTrackEverywhere(qc: QueryClient, ids: string[], patch: Partial<Track>) {
  const set = new Set(ids);
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const y = visit(x);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string' && set.has(o.id) && 'title' in o && 'artist' in o && 'playable' in o) return { ...o, ...patch };
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) {
        const y = visit(val);
        out[k] = y;
        if (y !== val) changed = true;
      }
      return changed ? out : v;
    }
    return v;
  };
  for (const q of qc.getQueryCache().getAll()) {
    const d = q.state.data;
    if (d === undefined) continue;
    const nd = visit(d);
    if (nd !== d) qc.setQueryData(q.queryKey, nd);
  }
  for (const id of ids) usePlayer.getState().updateTrack(id, patch);
}

export function useLike() {
  const qc = useQueryClient();
  return useCallback(
    async (tracks: Track[], like?: boolean) => {
      const target = like ?? !tracks.every((t) => t.liked);
      const ids = tracks.map((t) => t.id);
      patchTrackEverywhere(qc, ids, { liked: target });
      try {
        await api('/api/likes', { method: target ? 'POST' : 'DELETE', body: { trackIds: ids } });
        qc.invalidateQueries({ queryKey: ['liked'] });
        qc.invalidateQueries({ queryKey: ['home'] });
        if (tracks.length > 1) toast.success(target ? `Added ${tracks.length} songs to Liked Songs` : `Removed ${tracks.length} songs from Liked Songs`);
        else toast.success(target ? 'Added to Liked Songs' : 'Removed from Liked Songs', { label: 'Undo', run: () => void api('/api/likes', { method: target ? 'DELETE' : 'POST', body: { trackIds: ids } }).then(() => patchTrackEverywhere(qc, ids, { liked: !target })) });
      } catch (e) {
        patchTrackEverywhere(qc, ids, { liked: !target });
        toast.error((e as Error).message);
      }
    },
    [qc],
  );
}

export function useToggleFollow() {
  const qc = useQueryClient();
  return useCallback(
    async (artistId: string, follow: boolean, name?: string) => {
      try {
        await api(`/api/follows/${artistId}`, { method: follow ? 'POST' : 'DELETE' });
        qc.invalidateQueries({ queryKey: ['artist', artistId] });
        qc.invalidateQueries({ queryKey: ['library'] });
        toast.success(follow ? `Following ${name ?? 'artist'}` : `Unfollowed ${name ?? 'artist'}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [qc],
  );
}

export function useToggleSaveAlbum() {
  const qc = useQueryClient();
  return useCallback(
    async (albumId: string, save: boolean) => {
      try {
        await api(`/api/saved-albums/${albumId}`, { method: save ? 'POST' : 'DELETE' });
        qc.invalidateQueries({ queryKey: ['album', albumId] });
        qc.invalidateQueries({ queryKey: ['library'] });
        toast.success(save ? 'Saved to Your Library' : 'Removed from Your Library');
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [qc],
  );
}

export function usePlaylists() {
  return useQuery({ queryKey: ['playlists'], queryFn: () => api<Playlist[]>('/api/playlists'), staleTime: 15_000 });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useCallback(
    async (playlist: { id: string; name: string }, tracks: Track[], skipDuplicates = true) => {
      try {
        const r = await api<{ added: number; skipped: number }>(`/api/playlists/${playlist.id}/tracks`, { body: { trackIds: tracks.map((t) => t.id), skipDuplicates } });
        qc.invalidateQueries({ queryKey: ['playlist', playlist.id] });
        qc.invalidateQueries({ queryKey: ['playlists'] });
        if (r.added === 0 && r.skipped) toast.info(`Already in “${playlist.name}”`);
        else toast.success(`Added ${r.added === 1 ? '1 song' : `${r.added} songs`} to “${playlist.name}”${r.skipped ? ` (${r.skipped} already there)` : ''}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [qc],
  );
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    setM(mq.matches);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}

/** True after the first client render (avoids hydration mismatches when shared query caches fill early). */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
