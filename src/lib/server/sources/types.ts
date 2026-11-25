import type { HttpClient } from '../net';

export type SourceType = 'folder' | 'upload' | 'http' | 'playlist' | 'subsonic' | 'jellyfin' | 'manifest' | 'rss';

export interface SourceConfig {
  url?: string;
  path?: string;
  headers?: Record<string, string>;
  username?: string;
  password?: string;
  apiKey?: string;
  maxDepth?: number;
  maxFiles?: number;
  maxPages?: number;
  concurrency?: number;
  delayMs?: number;
  include?: string[];
  exclude?: string[];
  renderJs?: boolean;
  /** Allow following page links outside the starting path (same host). */
  wideScope?: boolean;
}

export interface RawTrack {
  locator: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  duration?: number;
  genre?: string;
  format?: string | null;
  mime?: string | null;
  bitrate?: number;
  size?: number;
  coverUrl?: string;
  coverData?: { data: Uint8Array; mime: string };
  explicit?: boolean;
  kind?: 'music' | 'podcast';
  /** Path used to infer metadata when tags are missing. */
  pathHint?: string;
  /** Link text, used as a title hint for opaque URLs. */
  textHint?: string;
  /** Ask the runner to read embedded tags (local file or HTTP range). */
  needsTags?: boolean;
  replaygain?: number;
  /** Local file modified time (ms); with size, lets re-scans skip unchanged files. */
  mtime?: number;
}

export interface SyncContext {
  client: HttpClient;
  config: SourceConfig;
  signal: AbortSignal;
  log: (msg: string) => void;
  page: () => void;
  /** Report a playlist discovered inside a source (M3U, Subsonic playlists...). Locators refer to tracks yielded. */
  playlist?: (name: string, locators: string[]) => void;
}

export interface Adapter {
  type: SourceType;
  sync(ctx: SyncContext): AsyncGenerator<RawTrack>;
  /** Turn a locator into an upstream URL (+headers) or local file path for streaming. */
  resolve(locator: string, config: SourceConfig): { kind: 'url'; url: string; headers?: Record<string, string> } | { kind: 'file'; path: string } | { kind: 'zip'; zipUrl: string; entry: string } ;
}

export interface DetectResult {
  type: SourceType;
  label: string;
  detail: string;
  needsAuth?: 'basic' | 'subsonic' | 'jellyfin' | null;
  suggestRenderJs?: boolean;
  preview: { title: string; detail?: string }[];
  counts?: { audio?: number; folders?: number; playlists?: number; archives?: number };
  finalUrl: string;
  name: string;
  warnings: string[];
}
