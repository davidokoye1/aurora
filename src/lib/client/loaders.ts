'use client';

import { api } from './api';
import type { Album, Mix, Playlist, Track } from '../types';

export const loadAlbum = async (id: string) => (await api<{ album: Album; tracks: Track[] }>(`/api/albums/${id}`)).tracks;
export const loadPlaylist = async (id: string) => (await api<{ playlist: Playlist; entries: { track: Track }[] }>(`/api/playlists/${id}`)).entries.map((e) => e.track);
export const loadMix = async (id: string) => (await api<Mix>(`/api/mixes/${id}`)).tracks;
export const loadArtist = async (id: string) => {
  const r = await api<{ popular: Track[]; all: Track[] }>(`/api/artists/${id}`);
  const seen = new Set(r.popular.map((t) => t.id));
  return [...r.popular, ...r.all.filter((t) => !seen.has(t.id))];
};
export const loadLiked = () => api<Track[]>('/api/likes');
export const loadMood = async (id: string) => (await api<Mix>(`/api/mood/${id}`)).tracks;
export const loadRadio = async (q: { track?: string; artist?: string }) => (await api<{ tracks: Track[] }>(`/api/recs/radio?${new URLSearchParams(q as Record<string, string>)}`)).tracks;
