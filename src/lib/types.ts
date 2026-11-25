/** Shared DTOs between server and client. */

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  albumId: string | null;
  duration: number | null;
  cover: string | null;
  year: number | null;
  genre: string | null;
  explicit: boolean;
  trackNo: number | null;
  discNo: number | null;
  bpm: number | null;
  energy: number | null;
  replaygain: number | null;
  loudness: number | null;
  kind: 'music' | 'podcast';
  formats: string[];
  playable: boolean;
  liked: boolean;
  addedAt: number;
  /** Every copy is on a source that's currently unreachable (e.g. an unplugged drive). */
  offline: boolean;
}

export interface Album {
  id: string;
  title: string;
  artist: string | null;
  artistId: string | null;
  year: number | null;
  cover: string | null;
  trackCount: number;
  saved?: boolean;
  addedAt?: number;
}

export interface Artist {
  id: string;
  name: string;
  image: string | null;
  trackCount: number;
  albumCount: number;
  tags: string[];
  followed?: boolean;
  bio?: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  cover: string | null;
  covers: string[];
  ownerId: string;
  ownerName: string;
  collaborative: boolean;
  trackCount: number;
  duration: number;
  createdAt: number;
  updatedAt: number;
  canEdit: boolean;
  isOwner: boolean;
}

export interface Mix {
  id: string;
  kind: 'daily' | 'discover' | 'onrepeat' | 'forgotten' | 'recent' | 'radio' | 'mood' | 'genre' | 'nl' | 'decade';
  title: string;
  subtitle: string;
  covers: string[];
  color: string;
  tracks: Track[];
}

export type SourceStatus = 'idle' | 'syncing' | 'ok' | 'error' | 'paused' | 'offline';

export interface SourceDTO {
  id: string;
  type: string;
  name: string;
  url: string | null;
  status: SourceStatus;
  paused: boolean;
  error: string | null;
  trackCount: number;
  lastSyncAt: number | null;
  createdAt: number;
  health: SourceHealth | null;
  config: { hasPassword: boolean; username?: string; headers?: Record<string, string>; maxDepth?: number; maxFiles?: number; concurrency?: number; delayMs?: number; include?: string[]; exclude?: string[]; renderJs?: boolean; wideScope?: boolean; hasApiKey?: boolean; path?: string };
  job: SyncProgress | null;
}

export interface SourceHealth {
  checkedAt: number;
  sampled: number;
  playable: number;
  rangeSupport: boolean | null;
  unplayableFormats: string[];
  errors: string[];
}

export interface SyncProgress {
  jobId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  pages: number;
  found: number;
  imported: number;
  errors: number;
  /** Files skipped on a re-scan because they haven't changed. */
  unchanged?: number;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
}

export interface UserSettings {
  theme: 'dark' | 'oled' | 'light';
  accent: string;
  adaptiveAccent: boolean;
  crossfade: number;
  gapless: boolean;
  normalize: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  explicitFilter: boolean;
  quality: 'best' | 'smallest';
  privateSession: boolean;
  enrichment: { musicbrainz: boolean; coverart: boolean; lyrics: boolean };
  homeOrder: string[];
  autoplay: boolean;
  reduceMotion: boolean;
  downloadQuality: 'best' | 'smallest';
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accent: '#ff5b2e',
  adaptiveAccent: true,
  crossfade: 0,
  gapless: true,
  normalize: true,
  eqEnabled: false,
  eqPreset: 'flat',
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  explicitFilter: false,
  quality: 'best',
  privateSession: false,
  enrichment: { musicbrainz: true, coverart: true, lyrics: true },
  homeOrder: ['quick', 'recent', 'mixes', 'discover', 'moods', 'added', 'albums', 'artists', 'forgotten'],
  autoplay: true,
  reduceMotion: false,
  downloadQuality: 'best',
};

export interface Me {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  settings: UserSettings;
}
