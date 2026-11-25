import 'server-only';
import { db, now, uid } from './db';
import { HttpError, type User } from './auth';
import { DEFAULT_SETTINGS, type Me, type Playlist, type UserSettings } from '../types';

export function getSettings(userId: string): UserSettings {
  const row = db.prepare('SELECT json FROM user_settings WHERE user_id = ?').get(userId) as { json: string } | undefined;
  const s = row ? (JSON.parse(row.json) as Partial<UserSettings>) : {};
  if (s.accent === '#8b7bff') delete s.accent; // previous default → new default
  return { ...DEFAULT_SETTINGS, ...s, enrichment: { ...DEFAULT_SETTINGS.enrichment, ...(s.enrichment ?? {}) } };
}

export function saveSettings(userId: string, patch: Partial<UserSettings>): UserSettings {
  const next = { ...getSettings(userId), ...patch };
  if (patch.enrichment) next.enrichment = { ...getSettings(userId).enrichment, ...patch.enrichment };
  db.prepare('INSERT INTO user_settings(user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').run(userId, JSON.stringify(next));
  return next;
}

export function meOf(u: User): Me {
  return { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, settings: getSettings(u.id) };
}

/* ------------------------------------------------------------------ playlists */

interface PlRow {
  id: string; owner_id: string; name: string; description: string; cover: string | null; collaborative: number; created_at: number; updated_at: number; owner_name: string;
  track_count: number; duration: number | null; covers: string | null; is_collab: number;
}

const PL_SELECT = `SELECT p.*, u.name owner_name,
  (SELECT count(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) track_count,
  (SELECT sum(t.duration) FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = p.id) duration,
  (SELECT group_concat(c, '|') FROM (SELECT DISTINCT COALESCE(t.cover, al.cover) c FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id LEFT JOIN albums al ON al.id = t.album_id
      WHERE pt.playlist_id = p.id AND COALESCE(t.cover, al.cover) IS NOT NULL ORDER BY pt.position LIMIT 4)) covers,
  EXISTS(SELECT 1 FROM playlist_collaborators c WHERE c.playlist_id = p.id AND c.user_id = @uid) is_collab
  FROM playlists p JOIN users u ON u.id = p.owner_id`;

function toPlaylist(r: PlRow, userId: string): Playlist {
  const isOwner = r.owner_id === userId;
  return {
    id: r.id, name: r.name, description: r.description, cover: r.cover, covers: r.covers ? r.covers.split('|') : [], ownerId: r.owner_id, ownerName: r.owner_name,
    collaborative: !!r.collaborative, trackCount: r.track_count, duration: r.duration ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
    isOwner, canEdit: isOwner || (!!r.collaborative && !!r.is_collab),
  };
}

export function listPlaylists(userId: string): Playlist[] {
  const rows = db
    .prepare(`${PL_SELECT} WHERE p.owner_id = @uid OR EXISTS(SELECT 1 FROM playlist_collaborators c WHERE c.playlist_id = p.id AND c.user_id = @uid) ORDER BY p.updated_at DESC`)
    .all({ uid: userId }) as PlRow[];
  return rows.map((r) => toPlaylist(r, userId));
}

export function getPlaylist(userId: string, id: string, opts: { allowPublic?: boolean } = {}): Playlist {
  const row = db.prepare(`${PL_SELECT} WHERE p.id = @id`).get({ uid: userId, id }) as PlRow | undefined;
  if (!row) throw new HttpError(404, 'Playlist not found');
  const pl = toPlaylist(row, userId);
  if (!pl.isOwner && !row.is_collab && !opts.allowPublic) {
    // Any signed-in user on this server may view playlists by link (personal server); editing is restricted.
  }
  return pl;
}

export function assertCanEdit(userId: string, id: string) {
  const pl = getPlaylist(userId, id);
  if (!pl.canEdit) throw new HttpError(403, 'You can’t edit this playlist');
  return pl;
}

export function createPlaylist(userId: string, name: string, description = '', trackIds: string[] = []) {
  const id = uid();
  db.prepare('INSERT INTO playlists(id,owner_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, userId, name.trim() || 'New Playlist', description, now(), now());
  if (trackIds.length) addTracks(userId, id, trackIds);
  return getPlaylist(userId, id);
}

export function addTracks(userId: string, playlistId: string, trackIds: string[], position?: number) {
  return db.transaction(() => {
    const max = (db.prepare('SELECT max(position) m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId) as { m: number | null }).m ?? 0;
    const ins = db.prepare('INSERT INTO playlist_tracks(id,playlist_id,track_id,position,added_by,added_at) VALUES (?,?,?,?,?,?)');
    const exists = db.prepare('SELECT 1 FROM tracks WHERE id = ?');
    let added = 0;
    if (position != null) {
      // insert before the item currently at `position` (0-based)
      const rows = db.prepare('SELECT id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlistId) as { id: string; position: number }[];
      const before = rows[position - 1]?.position ?? 0;
      const after = rows[position]?.position ?? before + trackIds.length + 1;
      const step = (after - before) / (trackIds.length + 1);
      trackIds.forEach((t, i) => {
        if (exists.get(t)) {
          ins.run(uid(), playlistId, t, before + step * (i + 1), userId, now());
          added++;
        }
      });
    } else {
      trackIds.forEach((t, i) => {
        if (exists.get(t)) {
          ins.run(uid(), playlistId, t, max + i + 1, userId, now());
          added++;
        }
      });
    }
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId);
    return added;
  })();
}
