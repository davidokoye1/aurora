import 'server-only';
import { db, norm } from './db';
import { queryAlbums, queryArtists, tracksByIds } from './catalog';
import { listPlaylists } from './user';
import { FAMILIES } from './recs/lexicon';
import type { Album, Artist, Playlist, Track } from '../types';

/** Damerau–Levenshtein (optimal string alignment) distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** 0..1 similarity of a query against a candidate string (token aware, prefix friendly). */
export function similarity(q: string, cand: string): number {
  const nq = norm(q);
  const nc = norm(cand);
  if (!nq || !nc) return 0;
  if (nc === nq) return 1;
  if (nc.startsWith(nq)) return 0.95 - Math.min(0.15, (nc.length - nq.length) / 100);
  if (nc.includes(nq)) return 0.85;
  const qt = nq.split(' ');
  const ct = nc.split(' ');
  let total = 0;
  for (const t of qt) {
    let best = 0;
    for (const c of ct) {
      if (c === t) {
        best = 1;
        break;
      }
      if (c.startsWith(t) && t.length >= 2) best = Math.max(best, 0.9);
      else {
        const len = Math.max(t.length, c.length);
        const tol = t.length <= 3 ? 0 : t.length <= 5 ? 1 : 2;
        const dist = editDistance(t, c.slice(0, Math.max(t.length + 1, Math.min(c.length, t.length + 2))));
        const distFull = editDistance(t, c);
        const dd = Math.min(dist, distFull);
        if (dd <= tol) best = Math.max(best, 1 - dd / (len + 1) - 0.08);
      }
    }
    total += best;
  }
  const whole = 1 - editDistance(nq, nc) / Math.max(nq.length, nc.length);
  return Math.max((total / qt.length) * 0.92, whole * 0.9);
}

function trigrams(s: string) {
  const out = new Set<string>();
  const n = norm(s).replace(/ /g, ' ');
  for (let i = 0; i + 3 <= n.length; i++) {
    const g = n.slice(i, i + 3);
    if (g.trim().length === 3) out.add(g);
  }
  return [...out];
}
const ftsQuote = (s: string) => '"' + s.replace(/"/g, '""') + '"';

export interface SearchResults {
  query: string;
  top: { kind: 'track'; item: Track } | { kind: 'artist'; item: Artist } | { kind: 'album'; item: Album } | null;
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  playlists: Playlist[];
  genres: { id: string; label: string; color: string }[];
  didYouMean: string | null;
}

function candidateTrackIds(q: string, limit = 400): string[] {
  const nq = norm(q);
  const ids = new Set<string>();
  if (nq.length < 3) {
    const rows = db.prepare(`SELECT id FROM tracks WHERE norm LIKE ? OR lower(artist_name) LIKE ? LIMIT ?`).all(`${nq}%`, `${nq}%`, limit) as { id: string }[];
    rows.forEach((r) => ids.add(r.id));
    return [...ids];
  }
  const words = nq.split(' ').filter((w) => w.length >= 3);
  try {
    if (words.length) {
      const strict = db.prepare(`SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ? ORDER BY bm25(tracks_fts, 0, 5, 3, 1, 0.5) LIMIT ?`).all(words.map(ftsQuote).join(' AND '), limit) as { track_id: string }[];
      strict.forEach((r) => ids.add(r.track_id));
    }
    if (ids.size < 40) {
      const tg = trigrams(q);
      if (tg.length) {
        const fuzzy = db.prepare(`SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ? ORDER BY bm25(tracks_fts, 0, 5, 3, 1, 0.5) LIMIT ?`).all(tg.map(ftsQuote).join(' OR '), limit) as { track_id: string }[];
        fuzzy.forEach((r) => ids.add(r.track_id));
      }
    }
  } catch {
    const rows = db.prepare(`SELECT id FROM tracks WHERE norm LIKE ? OR lower(artist_name) LIKE ? LIMIT ?`).all(`%${nq}%`, `%${nq}%`, limit) as { id: string }[];
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

export function search(userId: string, q: string, opts: { limit?: number; explicitFilter?: boolean } = {}): SearchResults {
  const limit = opts.limit ?? 30;
  const query = q.trim();
  const empty: SearchResults = { query, top: null, tracks: [], artists: [], albums: [], playlists: [], genres: [], didYouMean: null };
  if (!query) return empty;

  // Tracks
  const cands = tracksByIds(userId, candidateTrackIds(query));
  const scoredTracks = cands
    .filter((t) => !opts.explicitFilter || !t.explicit)
    .map((t) => {
      const st = similarity(query, t.title);
      const sa = similarity(query, t.artist);
      const sal = t.album ? similarity(query, t.album) : 0;
      const combo = similarity(query, `${t.artist} ${t.title}`);
      const combo2 = similarity(query, `${t.title} ${t.artist}`);
      return { t, s: Math.max(st, sa * 0.85, sal * 0.7, combo * 0.98, combo2 * 0.98) + (t.playable ? 0 : -0.2) };
    })
    .filter((x) => x.s > 0.45)
    .sort((a, b) => b.s - a.s);

  // Artists (JS fuzzy over the artist table)
  const artistRows = db.prepare(`SELECT ar.id, ar.name FROM artists ar WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = ar.id) OR EXISTS (SELECT 1 FROM followed_artists f WHERE f.artist_id = ar.id)`).all() as { id: string; name: string }[];
  const artistScores = artistRows.map((a) => ({ id: a.id, name: a.name, s: similarity(query, a.name) })).filter((x) => x.s > 0.55).sort((a, b) => b.s - a.s).slice(0, 12);
  const artistMap = new Map(queryArtists(userId, `WHERE ar.id IN (${artistScores.map((_, i) => '@a' + i).join(',') || "''"})`, Object.fromEntries(artistScores.map((a, i) => ['a' + i, a.id]))).map((a) => [a.id, a]));
  const artists = artistScores.map((a) => artistMap.get(a.id)).filter((a): a is Artist => !!a && a.trackCount > 0);

  // Albums
  const albumRows = db.prepare(`SELECT a.id, a.title, ar.name artist FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id) OR EXISTS (SELECT 1 FROM saved_albums s WHERE s.album_id = a.id)`).all() as { id: string; title: string; artist: string | null }[];
  const albumScores = albumRows
    .map((a) => ({ id: a.id, s: Math.max(similarity(query, a.title), similarity(query, `${a.artist ?? ''} ${a.title}`) * 0.95, a.artist ? similarity(query, a.artist) * 0.75 : 0) }))
    .filter((x) => x.s > 0.55)
    .sort((a, b) => b.s - a.s)
    .slice(0, 12);
  const albumMap = new Map(queryAlbums(userId, `WHERE a.id IN (${albumScores.map((_, i) => '@b' + i).join(',') || "''"})`, Object.fromEntries(albumScores.map((a, i) => ['b' + i, a.id]))).map((a) => [a.id, a]));
  const albums = albumScores.map((a) => albumMap.get(a.id)).filter((a): a is Album => !!a);

  const playlists = listPlaylists(userId).filter((p) => similarity(query, p.name) > 0.6 || similarity(query, p.description) > 0.8);

  const genreRows = db.prepare(`SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL`).all() as { genre: string }[];
  const fams = FAMILIES.filter((f) => similarity(query, f.label) > 0.7 || f.match.test(query.toLowerCase()) || genreRows.some((g) => similarity(query, g.genre) > 0.85 && f.match.test(g.genre.toLowerCase())));
  const genres = fams.slice(0, 6).map((f) => ({ id: f.id, label: f.label, color: f.color }));

  const tracks = scoredTracks.slice(0, limit).map((x) => x.t);
  const tTop = scoredTracks[0];
  const aTop = artistScores[0];
  const alTop = albumScores[0];
  let top: SearchResults['top'] = null;
  const best = Math.max(tTop?.s ?? 0, (aTop?.s ?? 0) + 0.03, alTop?.s ?? 0);
  if (best > 0.5) {
    if (aTop && aTop.s + 0.03 >= best && artists[0]) top = { kind: 'artist', item: artists[0] };
    else if (tTop && tTop.s >= best) top = { kind: 'track', item: tTop.t };
    else if (albums[0]) top = { kind: 'album', item: albums[0] };
  }

  // "Did you mean": best fuzzy name when nothing matched as a substring
  let didYouMean: string | null = null;
  const nq = norm(query);
  const anyLiteral =
    tracks.some((t) => norm(t.title).includes(nq) || norm(t.artist).includes(nq)) || artists.some((a) => norm(a.name).includes(nq)) || albums.some((a) => norm(a.title).includes(nq));
  if (!anyLiteral && nq.length >= 3) {
    const options = [...artistScores.map((a) => ({ text: a.name, s: a.s })), ...scoredTracks.slice(0, 5).map((x) => ({ text: x.t.title, s: similarity(query, x.t.title) }))].sort((a, b) => b.s - a.s);
    if (options[0] && options[0].s > 0.55 && norm(options[0].text) !== nq) didYouMean = options[0].text;
  }
  return { query, top, tracks, artists: artists.slice(0, 10), albums: albums.slice(0, 10), playlists: playlists.slice(0, 8), genres, didYouMean };
}

export function suggest(userId: string, q: string): { text: string; kind: 'track' | 'artist' | 'album' | 'history'; id?: string }[] {
  const nq = norm(q);
  if (!nq) {
    return (db.prepare('SELECT query, max(created_at) m FROM search_history WHERE user_id = ? GROUP BY lower(query) ORDER BY m DESC LIMIT 8').all(userId) as { query: string }[]).map((r) => ({ text: r.query, kind: 'history' as const }));
  }
  const out: { text: string; kind: 'track' | 'artist' | 'album' | 'history'; id?: string; s: number }[] = [];
  for (const r of db.prepare('SELECT query FROM search_history WHERE user_id = ? AND lower(query) LIKE ? GROUP BY lower(query) LIMIT 3').all(userId, `${q.toLowerCase()}%`) as { query: string }[]) out.push({ text: r.query, kind: 'history', s: 1.1 });
  for (const a of db.prepare('SELECT id, name FROM artists WHERE norm LIKE ? LIMIT 5').all(`%${nq}%`) as { id: string; name: string }[]) out.push({ text: a.name, kind: 'artist', id: a.id, s: similarity(q, a.name) + 0.05 });
  for (const a of db.prepare('SELECT id, title FROM albums WHERE norm LIKE ? LIMIT 4').all(`%${nq}%`) as { id: string; title: string }[]) out.push({ text: a.title, kind: 'album', id: a.id, s: similarity(q, a.title) });
  for (const t of db.prepare('SELECT id, title FROM tracks WHERE norm LIKE ? LIMIT 6').all(`${nq}%`) as { id: string; title: string }[]) out.push({ text: t.title, kind: 'track', id: t.id, s: similarity(q, t.title) });
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.s - a.s)
    .filter((x) => {
      const k = x.kind + norm(x.text);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8)
    .map(({ s: _s, ...r }) => r);
}
