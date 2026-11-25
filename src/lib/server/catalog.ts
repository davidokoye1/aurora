import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now, uid, norm, ART_DIR } from './db';
import type { RawTrack } from './sources/types';
import { parsePath, browserPlayable } from './sources/media';
import type { Track, Album, Artist } from '../types';

/* ------------------------------------------------------------------ artwork */

const IMG_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return null;
}

/** Store image bytes content-addressed; returns the public URL. */
export function saveArt(data: Uint8Array, mime?: string): string | null {
  const real = sniffImage(data) ?? mime;
  const ext = real ? IMG_EXT[real.toLowerCase()] : undefined;
  if (!ext || data.byteLength < 100) return null;
  const name = crypto.createHash('sha1').update(data).digest('hex').slice(0, 24) + '.' + ext;
  const file = path.join(ART_DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, data);
  return `/api/art/${name}`;
}

/* ------------------------------------------------------------------ upsert */

function ensureArtist(name: string): string {
  const n = norm(name) || 'unknown artist';
  const row = db.prepare('SELECT id FROM artists WHERE norm = ?').get(n) as { id: string } | undefined;
  if (row) return row.id;
  const id = uid();
  db.prepare('INSERT INTO artists(id,name,norm,created_at) VALUES (?,?,?,?)').run(id, name.trim() || 'Unknown Artist', n, now());
  return id;
}

function ensureAlbum(title: string, artistId: string, year?: number, cover?: string | null): string {
  const n = norm(title);
  const row = db.prepare('SELECT id, year, cover FROM albums WHERE norm = ? AND artist_id = ?').get(n, artistId) as
    | { id: string; year: number | null; cover: string | null }
    | undefined;
  if (row) {
    if ((!row.year && year) || (!row.cover && cover)) {
      db.prepare('UPDATE albums SET year = COALESCE(year, ?), cover = COALESCE(cover, ?) WHERE id = ?').run(year ?? null, cover ?? null, row.id);
    }
    return row.id;
  }
  const id = uid();
  db.prepare('INSERT INTO albums(id,title,norm,artist_id,year,cover,created_at) VALUES (?,?,?,?,?,?,?)').run(id, title.trim(), n, artistId, year ?? null, cover ?? null, now());
  return id;
}

function cleanTitle(s?: string) {
  return s?.replace(/\s+/g, ' ').trim() || undefined;
}

export function finalizeRaw(raw: RawTrack): RawTrack & { title: string; artist: string } {
  const hint = raw.pathHint ? parsePath(raw.pathHint) : {};
  let textTitle: string | undefined;
  if (raw.textHint && raw.textHint.length < 200 && !/^(download|play|listen|stream|link|mp3|flac|get|here)$/i.test(raw.textHint.trim())) {
    textTitle = raw.textHint.replace(/\.(mp3|flac|m4a|ogg|opus|wav|aac)$/i, '').trim();
  }
  const opaque = !hint.title || /^[\w-]{16,}$/.test(hint.title) || /^\d+$/.test(hint.title) || /^(download|stream|file|get|index)$/i.test(hint.title);
  let title = cleanTitle(raw.title) ?? (opaque && textTitle ? textTitle : hint.title) ?? textTitle ?? 'Untitled';
  let artist = cleanTitle(raw.artist) ?? hint.artist ?? raw.albumArtist ?? hint.albumArtist;
  if (!raw.artist && opaque && textTitle) {
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(textTitle);
    if (m) {
      artist = artist ?? m[1];
      title = m[2];
    }
  }
  return {
    ...raw,
    title,
    artist: artist ?? 'Unknown Artist',
    albumArtist: cleanTitle(raw.albumArtist) ?? hint.albumArtist,
    album: cleanTitle(raw.album) ?? hint.album,
    trackNo: raw.trackNo ?? hint.trackNo,
    discNo: raw.discNo ?? hint.discNo,
    year: raw.year ?? hint.year,
  };
}

/** Locator without format suffixes, used to group alternate encodings of one file. Only for URL locators. */
export function stemOf(locator: string): string | null {
  if (!/^(https?|zip):/.test(locator)) return null;
  const q = locator.indexOf('?');
  if (q >= 0) return null;
  const m = /^(.*?)(?:[_.-](?:\d{2,3}kb|vbr|hq|lq))?\.(mp3|flac|ogg|oga|opus|m4a|aac|wav|aiff?|wma)$/i.exec(locator);
  return m ? m[1] : null;
}

function updateFts(trackId: string) {
  const t = db.prepare('SELECT title, artist_name, album_title, genre FROM tracks WHERE id = ?').get(trackId) as
    | { title: string; artist_name: string; album_title: string | null; genre: string | null }
    | undefined;
  db.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(trackId);
  if (t) db.prepare('INSERT INTO tracks_fts(track_id,title,artist,album,genre) VALUES (?,?,?,?,?)').run(trackId, t.title, t.artist_name, t.album_title ?? '', t.genre ?? '');
}

/**
 * Insert or update a track + copy from a source. Dedupes across sources by normalised artist + title + duration (±2s).
 * Returns the track id.
 */
export const upsertTrack = db.transaction((rawIn: RawTrack, sourceId: string, stamp: number, coverUrl: string | null): string => {
  const raw = finalizeRaw(rawIn);
  const artistId = ensureArtist(raw.artist);
  const albumArtistName = raw.albumArtist ?? raw.artist;
  const albumArtistId = norm(albumArtistName) === norm(raw.artist) ? artistId : ensureArtist(albumArtistName);
  const albumId = raw.album ? ensureAlbum(raw.album, albumArtistId, raw.year, coverUrl) : null;
  const playable = browserPlayable(raw.format) ? 1 : 0;

  const existing = db.prepare('SELECT id, track_id FROM track_copies WHERE source_id = ? AND locator = ?').get(sourceId, raw.locator) as
    | { id: string; track_id: string }
    | undefined;

  const fields = {
    title: raw.title,
    norm: norm(raw.title),
    artist_id: artistId,
    album_id: albumId,
    artist_name: raw.artist,
    album_title: raw.album ?? null,
    track_no: raw.trackNo ?? null,
    disc_no: raw.discNo ?? null,
    year: raw.year ?? null,
    duration: raw.duration ?? null,
    genre: raw.genre ?? null,
    explicit: raw.explicit ? 1 : 0,
    cover: coverUrl,
    replaygain: raw.replaygain ?? null,
    kind: raw.kind ?? 'music',
  };

  let trackId: string;
  if (existing) {
    trackId = existing.track_id;
    db.prepare(
      `UPDATE tracks SET title=@title, norm=@norm, artist_id=@artist_id, album_id=@album_id, artist_name=@artist_name, album_title=@album_title,
        track_no=@track_no, disc_no=@disc_no, year=COALESCE(@year, year), duration=COALESCE(@duration, duration), genre=COALESCE(@genre, genre),
        explicit=@explicit, cover=COALESCE(@cover, cover), replaygain=COALESCE(@replaygain, replaygain), kind=@kind WHERE id=@id`,
    ).run({ ...fields, id: trackId });
    db.prepare('UPDATE track_copies SET format=?, mime=?, bitrate=?, size=?, playable=?, last_seen=?, file_mtime=? WHERE id=?').run(
      raw.format ?? null, raw.mime ?? null, raw.bitrate ?? null, raw.size ?? null, playable, stamp, raw.mtime ?? null, existing.id,
    );
  } else {
    // Same file in several formats within one source ("song.flac", "song.mp3", "song_64kb.mp3") → one track, many copies
    const stem = stemOf(raw.locator);
    const sibling = stem
      ? (db
          .prepare(`SELECT track_id, locator FROM track_copies WHERE source_id = ? AND locator LIKE ? ESCAPE '\\' LIMIT 20`)
          .all(sourceId, stem.replace(/[\\%_]/g, (c) => '\\' + c) + '%') as { track_id: string; locator: string }[]).find((c) => stemOf(c.locator) === stem)
      : undefined;
    if (sibling) {
      db.prepare(
        'INSERT INTO track_copies(id,track_id,source_id,locator,format,mime,bitrate,size,playable,last_seen,created_at,file_mtime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(uid(), sibling.track_id, sourceId, raw.locator, raw.format ?? null, raw.mime ?? null, raw.bitrate ?? null, raw.size ?? null, playable, stamp, now(), raw.mtime ?? null);
      if (rawIn.title && rawIn.artist) {
        // this encoding carries real tags — prefer them over filename-derived metadata
        db.prepare(
          `UPDATE tracks SET title=@title, norm=@norm, artist_id=@artist_id, album_id=COALESCE(@album_id, album_id), artist_name=@artist_name, album_title=COALESCE(@album_title, album_title),
            track_no=COALESCE(@track_no, track_no), year=COALESCE(@year, year), duration=COALESCE(duration, @duration), genre=COALESCE(@genre, genre), cover=COALESCE(cover, @cover) WHERE id=@id`,
        ).run({ ...fields, id: sibling.track_id });
      } else {
        db.prepare('UPDATE tracks SET duration = COALESCE(duration, ?), cover = COALESCE(cover, ?), genre = COALESCE(genre, ?), year = COALESCE(year, ?) WHERE id = ?').run(
          fields.duration, coverUrl, fields.genre, fields.year, sibling.track_id,
        );
      }
      updateFts(sibling.track_id);
      return sibling.track_id;
    }
    const dup = db
      .prepare(
        `SELECT id FROM tracks WHERE norm = @norm AND artist_id = @artist AND kind = @kind AND (
           (@album IS NOT NULL AND album_id = @album AND (duration IS NULL OR @dur IS NULL OR abs(duration - @dur) <= 5))
           OR ((duration IS NULL OR @dur IS NULL OR abs(duration - @dur) <= 2) AND (album_id IS NULL OR @album IS NULL OR album_id = @album))
         ) ORDER BY (album_id = @album) DESC LIMIT 1`,
      )
      .get({ norm: fields.norm, artist: artistId, kind: fields.kind, album: albumId, dur: fields.duration }) as { id: string } | undefined;
    if (dup) {
      trackId = dup.id;
      db.prepare('UPDATE tracks SET duration = COALESCE(duration, ?), cover = COALESCE(cover, ?), genre = COALESCE(genre, ?), year = COALESCE(year, ?), album_id = COALESCE(album_id, ?), album_title = COALESCE(album_title, ?) WHERE id = ?').run(
        fields.duration, coverUrl, fields.genre, fields.year, albumId, fields.album_title, trackId,
      );
    } else {
      trackId = uid();
      db.prepare(
        `INSERT INTO tracks(id,title,norm,artist_id,album_id,artist_name,album_title,track_no,disc_no,year,duration,genre,explicit,cover,replaygain,kind,added_at)
         VALUES (@id,@title,@norm,@artist_id,@album_id,@artist_name,@album_title,@track_no,@disc_no,@year,@duration,@genre,@explicit,@cover,@replaygain,@kind,@added_at)`,
      ).run({ ...fields, id: trackId, added_at: now() });
    }
    db.prepare(
      'INSERT INTO track_copies(id,track_id,source_id,locator,format,mime,bitrate,size,playable,last_seen,created_at,file_mtime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(uid(), trackId, sourceId, raw.locator, raw.format ?? null, raw.mime ?? null, raw.bitrate ?? null, raw.size ?? null, playable, stamp, now(), raw.mtime ?? null);
  }
  updateFts(trackId);
  return trackId;
});

/** Remove copies not seen in the latest sync; delete orphaned tracks unless they're referenced by a user. */
export function pruneSource(sourceId: string, stamp: number) {
  return db.transaction(() => {
    const stale = db.prepare('SELECT track_id FROM track_copies WHERE source_id = ? AND last_seen < ?').all(sourceId, stamp) as { track_id: string }[];
    db.prepare('DELETE FROM track_copies WHERE source_id = ? AND last_seen < ?').run(sourceId, stamp);
    return cleanupOrphans(stale.map((s) => s.track_id));
  })();
}

export function cleanupOrphans(trackIds?: string[]) {
  const where = trackIds ? `AND t.id IN (${trackIds.map(() => '?').join(',') || "''"})` : '';
  const orphans = db
    .prepare(
      `SELECT t.id FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM track_copies c WHERE c.track_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM playlist_tracks p WHERE p.track_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.track_id = t.id) ${where}`,
    )
    .all(...(trackIds ?? [])) as { id: string }[];
  for (const o of orphans) {
    db.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(o.id);
    db.prepare('DELETE FROM tracks WHERE id = ?').run(o.id);
  }
  db.exec(`DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = albums.id) AND NOT EXISTS (SELECT 1 FROM saved_albums s WHERE s.album_id = albums.id)`);
  db.exec(`DELETE FROM artists WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = artists.id) AND NOT EXISTS (SELECT 1 FROM albums a WHERE a.artist_id = artists.id) AND NOT EXISTS (SELECT 1 FROM followed_artists f WHERE f.artist_id = artists.id)`);
  return orphans.length;
}

/* ------------------------------------------------------------------ queries */

export const TRACK_COLS = `
  t.id, t.title, t.artist_name, t.artist_id, t.album_title, t.album_id, t.duration, COALESCE(t.cover, al.cover) AS cover_eff, t.year, t.genre,
  t.explicit, t.track_no, t.disc_no, t.bpm, t.energy, t.replaygain, t.loudness, t.kind, t.added_at,
  (SELECT group_concat(DISTINCT c.format) FROM track_copies c WHERE c.track_id = t.id) AS formats,
  (SELECT max(c.playable) FROM track_copies c WHERE c.track_id = t.id) AS playable_any,
  EXISTS(SELECT 1 FROM likes lk WHERE lk.user_id = @uid AND lk.track_id = t.id) AS liked,
  (SELECT s.status FROM track_copies c JOIN sources s ON s.id = c.source_id WHERE c.track_id = t.id ORDER BY c.playable DESC LIMIT 1) AS source_status`;

export interface TrackRow {
  id: string; title: string; artist_name: string; artist_id: string | null; album_title: string | null; album_id: string | null; duration: number | null;
  cover_eff: string | null; year: number | null; genre: string | null; explicit: number; track_no: number | null; disc_no: number | null;
  bpm: number | null; energy: number | null; replaygain: number | null; loudness: number | null; kind: string; added_at: number; formats: string | null; playable_any: number | null; liked: number;
  source_status: string | null;
}

export function toTrack(r: TrackRow): Track {
  return {
    id: r.id, title: r.title, artist: r.artist_name, artistId: r.artist_id, album: r.album_title, albumId: r.album_id, duration: r.duration,
    cover: r.cover_eff, year: r.year, genre: r.genre, explicit: !!r.explicit, trackNo: r.track_no, discNo: r.disc_no, bpm: r.bpm, energy: r.energy,
    replaygain: r.replaygain, loudness: r.loudness, kind: r.kind === 'podcast' ? 'podcast' : 'music', formats: r.formats ? r.formats.split(',').filter(Boolean) : [],
    playable: !!r.playable_any, liked: !!r.liked, addedAt: r.added_at,
    offline: r.source_status === 'offline',
  };
}

/** Run a track query. `tail` is SQL after FROM tracks t LEFT JOIN albums al (joins/WHERE/ORDER/LIMIT). */
export function queryTracks(userId: string, tail: string, params: Record<string, unknown> = {}): Track[] {
  const rows = db.prepare(`SELECT ${TRACK_COLS} FROM tracks t LEFT JOIN albums al ON al.id = t.album_id ${tail}`).all({ uid: userId, ...params }) as TrackRow[];
  return rows.map(toTrack);
}

export function tracksByIds(userId: string, ids: string[]): Track[] {
  if (!ids.length) return [];
  const out: Track[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const params: Record<string, unknown> = {};
    chunk.forEach((id, j) => (params['i' + j] = id));
    out.push(...queryTracks(userId, `WHERE t.id IN (${chunk.map((_, j) => '@i' + j).join(',')})`, params));
  }
  const map = new Map(out.map((t) => [t.id, t]));
  return ids.map((id) => map.get(id)).filter((t): t is Track => !!t);
}

export const ALBUM_COLS = `a.id, a.title, a.year, a.cover, a.artist_id, a.created_at, ar.name AS artist_name,
  (SELECT count(*) FROM tracks t WHERE t.album_id = a.id) AS track_count,
  (SELECT t.cover FROM tracks t WHERE t.album_id = a.id AND t.cover IS NOT NULL LIMIT 1) AS track_cover,
  EXISTS(SELECT 1 FROM saved_albums s WHERE s.user_id = @uid AND s.album_id = a.id) AS saved`;

export interface AlbumRow { id: string; title: string; year: number | null; cover: string | null; artist_id: string | null; artist_name: string | null; track_count: number; track_cover: string | null; saved: number; created_at: number }
export function toAlbum(r: AlbumRow): Album {
  return { id: r.id, title: r.title, year: r.year, cover: r.cover ?? r.track_cover, artistId: r.artist_id, artist: r.artist_name, trackCount: r.track_count, saved: !!r.saved, addedAt: r.created_at };
}
export function queryAlbums(userId: string, tail: string, params: Record<string, unknown> = {}): Album[] {
  return (db.prepare(`SELECT ${ALBUM_COLS} FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id ${tail}`).all({ uid: userId, ...params }) as AlbumRow[]).map(toAlbum);
}

export const ARTIST_COLS = `ar.id, ar.name, ar.image, ar.tags, ar.bio,
  (SELECT count(*) FROM tracks t WHERE t.artist_id = ar.id) AS track_count,
  (SELECT count(*) FROM albums a WHERE a.artist_id = ar.id) AS album_count,
  (SELECT COALESCE(a.cover, (SELECT t2.cover FROM tracks t2 WHERE t2.album_id = a.id AND t2.cover IS NOT NULL LIMIT 1)) FROM albums a WHERE a.artist_id = ar.id AND (a.cover IS NOT NULL OR EXISTS(SELECT 1 FROM tracks t3 WHERE t3.album_id = a.id AND t3.cover IS NOT NULL)) LIMIT 1) AS album_cover,
  EXISTS(SELECT 1 FROM followed_artists f WHERE f.user_id = @uid AND f.artist_id = ar.id) AS followed`;
export interface ArtistRow { id: string; name: string; image: string | null; tags: string | null; bio: string | null; track_count: number; album_count: number; album_cover: string | null; followed: number }
export function toArtist(r: ArtistRow): Artist {
  return { id: r.id, name: r.name, image: r.image ?? r.album_cover, trackCount: r.track_count, albumCount: r.album_count, tags: r.tags ? JSON.parse(r.tags) : [], followed: !!r.followed, bio: r.bio };
}
export function queryArtists(userId: string, tail: string, params: Record<string, unknown> = {}): Artist[] {
  return (db.prepare(`SELECT ${ARTIST_COLS} FROM artists ar ${tail}`).all({ uid: userId, ...params }) as ArtistRow[]).map(toArtist);
}

export function libraryStats() {
  return db.prepare(`SELECT (SELECT count(*) FROM tracks) tracks, (SELECT count(DISTINCT album_id) FROM tracks) albums, (SELECT count(DISTINCT artist_id) FROM tracks) artists, (SELECT count(*) FROM sources WHERE type != 'upload') sources`).get() as {
    tracks: number; albums: number; artists: number; sources: number;
  };
}
