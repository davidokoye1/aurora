import 'server-only';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const ART_DIR = path.join(DATA_DIR, 'art');
for (const d of [DATA_DIR, UPLOAD_DIR, CACHE_DIR, ART_DIR]) fs.mkdirSync(d, { recursive: true });

const MIGRATIONS: string[] = [
  /* 1: core */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  );

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    config_enc TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    paused INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    health_json TEXT,
    track_count INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sync_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    log TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX sync_jobs_source ON sync_jobs(source_id, started_at);

  CREATE TABLE artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    norm TEXT NOT NULL UNIQUE,
    mbid TEXT,
    image TEXT,
    bio TEXT,
    tags TEXT,
    enriched_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE albums (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    norm TEXT NOT NULL,
    artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
    year INTEGER,
    cover TEXT,
    mbid TEXT,
    enriched_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(norm, artist_id)
  );
  CREATE INDEX albums_artist ON albums(artist_id);
  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    norm TEXT NOT NULL,
    artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
    album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
    artist_name TEXT NOT NULL DEFAULT 'Unknown Artist',
    album_title TEXT,
    track_no INTEGER,
    disc_no INTEGER,
    year INTEGER,
    duration REAL,
    genre TEXT,
    explicit INTEGER NOT NULL DEFAULT 0,
    cover TEXT,
    bpm REAL,
    energy REAL,
    brightness REAL,
    loudness REAL,
    replaygain REAL,
    features_at INTEGER,
    kind TEXT NOT NULL DEFAULT 'music',
    added_at INTEGER NOT NULL
  );
  CREATE INDEX tracks_artist ON tracks(artist_id);
  CREATE INDEX tracks_album ON tracks(album_id, disc_no, track_no);
  CREATE INDEX tracks_norm ON tracks(norm);
  CREATE INDEX tracks_added ON tracks(added_at);
  CREATE TABLE track_copies (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    locator TEXT NOT NULL,
    format TEXT,
    mime TEXT,
    bitrate INTEGER,
    size INTEGER,
    playable INTEGER NOT NULL DEFAULT 1,
    direct_ok INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(source_id, locator)
  );
  CREATE INDEX copies_track ON track_copies(track_id);
  CREATE TABLE lyrics (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    synced TEXT,
    plain TEXT,
    source TEXT,
    fetched_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE tracks_fts USING fts5(track_id UNINDEXED, title, artist, album, genre, tokenize='trigram');

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover TEXT,
    collaborative INTEGER NOT NULL DEFAULT 0,
    origin TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX playlists_owner ON playlists(owner_id);
  CREATE TABLE playlist_tracks (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position REAL NOT NULL,
    added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX pt_playlist ON playlist_tracks(playlist_id, position);
  CREATE TABLE playlist_collaborators (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, user_id)
  );
  CREATE TABLE likes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );
  CREATE TABLE saved_albums (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, album_id)
  );
  CREATE TABLE followed_artists (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_id)
  );
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (collection_id, kind, ref_id)
  );
  CREATE TABLE play_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    ms_played INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    context TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX pe_user_time ON play_events(user_id, created_at);
  CREATE INDEX pe_user_track ON play_events(user_id, track_id);
  CREATE TABLE search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sh_user ON search_history(user_id, created_at);
  CREATE TABLE share_links (
    token TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'view',
    created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE kv_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  /* 2: built-in catalog (Audius / Deezer / Internet Archive) */ `
  ALTER TABLE tracks ADD COLUMN origin TEXT NOT NULL DEFAULT 'library';
  ALTER TABLE tracks ADD COLUMN saved INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE track_copies ADD COLUMN kind TEXT NOT NULL DEFAULT 'full';
  ALTER TABLE track_copies ADD COLUMN downloadable INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX tracks_origin ON tracks(origin);
  `,
  /* 3: own-library only — remove the online catalog; file stamps for fast re-scans */ `
  DELETE FROM sources WHERE type IN ('audius', 'deezer', 'archive-catalog');
  DELETE FROM tracks_fts WHERE track_id IN (SELECT t.id FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM track_copies c WHERE c.track_id = t.id));
  DELETE FROM tracks WHERE NOT EXISTS (SELECT 1 FROM track_copies c WHERE c.track_id = tracks.id);
  DELETE FROM saved_albums WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = saved_albums.album_id);
  DELETE FROM followed_artists WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = followed_artists.artist_id);
  DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = albums.id) AND NOT EXISTS (SELECT 1 FROM saved_albums s WHERE s.album_id = albums.id);
  DELETE FROM artists WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = artists.id) AND NOT EXISTS (SELECT 1 FROM albums a WHERE a.artist_id = artists.id) AND NOT EXISTS (SELECT 1 FROM followed_artists f WHERE f.artist_id = artists.id);
  DELETE FROM kv_cache;
  UPDATE tracks SET origin = 'library', saved = 0;
  ALTER TABLE track_copies ADD COLUMN file_mtime INTEGER;
  `,
];

function open() {
  const db = new Database(path.join(DATA_DIR, 'aurora.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

const g = globalThis as unknown as { __auroraDb?: Database.Database };
export const db: Database.Database = g.__auroraDb ?? (g.__auroraDb = open());

export const now = () => Date.now();
export const uid = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

/** Normalise strings for matching/deduping: lowercase, strip accents, punctuation & noise words. */
export function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\(.*?(remaster|explicit|clean|bonus|deluxe).*?\)|\[.*?(remaster|explicit|clean|bonus|deluxe).*?\]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function cacheGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value, expires_at FROM kv_cache WHERE key = ?').get(key) as { value: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now()) return undefined;
  return JSON.parse(row.value) as T;
}
export function cacheSet(key: string, value: unknown, ttlMs: number) {
  db.prepare('INSERT OR REPLACE INTO kv_cache(key, value, expires_at) VALUES (?,?,?)').run(key, JSON.stringify(value), now() + ttlMs);
}
