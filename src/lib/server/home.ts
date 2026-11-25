import 'server-only';
import { db, now } from './db';
import { queryAlbums, queryArtists, queryTracks, tracksByIds, libraryStats } from './catalog';
import { listPlaylists, getSettings } from './user';
import { dailyMixes, discoverWeekly, onRepeat, forgottenFavorites, profile, index, affinity, moodMix, rng } from './recs/engine';
import { familiesOf, familyById, MOODS } from './recs/lexicon';
import type { Album, Artist, Mix, Playlist, Track } from '../types';

export interface HomeData {
  stats: ReturnType<typeof libraryStats>;
  hasHistory: boolean;
  quick: { kind: 'liked' | 'playlist' | 'mix' | 'album'; id: string; title: string; cover: string | null; covers: string[]; color?: string }[];
  recent: Track[];
  recentContexts: { kind: string; id: string; title: string; cover: string | null; subtitle: string }[];
  mixes: Mix[];
  discover: Mix[];
  added: Album[];
  albums: Album[];
  artists: Artist[];
  moods: { id: string; label: string; blurb: string; gradient: [string, string]; covers: string[] }[];
  forgotten: Mix | null;
  order: string[];
}

export function recentTracks(userId: string, limit = 24): Track[] {
  const rows = db
    .prepare(`SELECT track_id, max(created_at) m FROM play_events WHERE user_id = ? GROUP BY track_id ORDER BY m DESC LIMIT ?`)
    .all(userId, limit) as { track_id: string }[];
  return tracksByIds(userId, rows.map((r) => r.track_id));
}

export function home(userId: string): HomeData {
  const settings = getSettings(userId);
  const ex = settings.explicitFilter;
  const stats = libraryStats();
  const p = profile(userId);
  const hasHistory = p.strength > 0;
  const mixes = dailyMixes(userId, ex);
  const discover = [discoverWeekly(userId, ex), onRepeat(userId)].filter((m): m is Mix => !!m && m.tracks.length > 0);
  const forgotten = forgottenFavorites(userId);
  const playlists = listPlaylists(userId);
  const likedCount = (db.prepare('SELECT count(*) c FROM likes WHERE user_id = ?').get(userId) as { c: number }).c;
  const likedCovers = (db
    .prepare(`SELECT DISTINCT COALESCE(t.cover, al.cover) c FROM likes l JOIN tracks t ON t.id = l.track_id LEFT JOIN albums al ON al.id = t.album_id WHERE l.user_id = ? AND COALESCE(t.cover, al.cover) IS NOT NULL ORDER BY l.created_at DESC LIMIT 4`)
    .all(userId) as { c: string }[]).map((r) => r.c);

  // Recently played contexts (albums/playlists the user played from)
  const ctxRows = db
    .prepare(`SELECT context, max(created_at) m FROM play_events WHERE user_id = ? AND context IS NOT NULL GROUP BY context ORDER BY m DESC LIMIT 12`)
    .all(userId) as { context: string }[];
  const recentContexts: HomeData['recentContexts'] = [];
  for (const { context } of ctxRows) {
    const [kind, id] = context.split(':');
    if (kind === 'album') {
      const a = queryAlbums(userId, 'WHERE a.id = @id', { id })[0];
      if (a) recentContexts.push({ kind, id, title: a.title, cover: a.cover, subtitle: a.artist ?? 'Album' });
    } else if (kind === 'playlist') {
      const pl = playlists.find((x) => x.id === id);
      if (pl) recentContexts.push({ kind, id, title: pl.name, cover: pl.cover ?? pl.covers[0] ?? null, subtitle: `Playlist · ${pl.ownerName}` });
    } else if (kind === 'artist') {
      const a = queryArtists(userId, 'WHERE ar.id = @id', { id })[0];
      if (a) recentContexts.push({ kind, id, title: a.name, cover: a.image, subtitle: 'Artist' });
    } else if (kind === 'mix') {
      const m = [...mixes, ...discover].find((x) => x.id === id);
      if (m) recentContexts.push({ kind, id, title: m.title, cover: m.covers[0] ?? null, subtitle: 'Made for you' });
    }
    if (recentContexts.length >= 8) break;
  }

  const quick: HomeData['quick'] = [];
  if (likedCount) quick.push({ kind: 'liked', id: 'liked', title: 'Liked Songs', cover: null, covers: likedCovers });
  for (const c of recentContexts) {
    if (quick.length >= 8) break;
    if (c.kind === 'playlist' || c.kind === 'album' || c.kind === 'mix') quick.push({ kind: c.kind as 'playlist' | 'album' | 'mix', id: c.id, title: c.title, cover: c.cover, covers: c.cover ? [c.cover] : [] });
  }
  for (const pl of playlists) {
    if (quick.length >= 8) break;
    if (!quick.some((q) => q.id === pl.id)) quick.push({ kind: 'playlist', id: pl.id, title: pl.name, cover: pl.cover, covers: pl.covers });
  }
  for (const m of mixes) {
    if (quick.length >= 8) break;
    quick.push({ kind: 'mix', id: m.id, title: m.title, cover: null, covers: m.covers, color: m.color });
  }

  const added = queryAlbums(userId, `WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.kind = 'music') ORDER BY a.created_at DESC LIMIT 16`);

  // Recommended albums: average affinity of each album's tracks, seeded daily
  const idx = index();
  const r = rng(userId + new Date().toISOString().slice(0, 10) + 'albums');
  const albumScore = new Map<string, { s: number; n: number }>();
  for (const f of idx.feats) {
    if (!f.albumId || f.kind !== 'music') continue;
    const e = albumScore.get(f.albumId) ?? { s: 0, n: 0 };
    e.s += affinity(p, f);
    e.n++;
    albumScore.set(f.albumId, e);
  }
  const saved = new Set((db.prepare('SELECT album_id FROM saved_albums WHERE user_id = ?').all(userId) as { album_id: string }[]).map((x) => x.album_id));
  const topAlbums = [...albumScore.entries()]
    .filter(([id, e]) => e.n >= 2 && !saved.has(id))
    .map(([id, e]) => ({ id, s: e.s / e.n + r() * 0.5 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 16)
    .map((x) => x.id);
  const albumsMap = new Map(queryAlbums(userId, `WHERE a.id IN (${topAlbums.map((_, i) => '@x' + i).join(',') || "''"})`, Object.fromEntries(topAlbums.map((id, i) => ['x' + i, id]))).map((a) => [a.id, a]));
  const albums = topAlbums.map((id) => albumsMap.get(id)).filter((a): a is Album => !!a);

  // Artists: most-played first, then taste-matched, then most tracks
  const artistScore = new Map<string, number>();
  for (const f of idx.feats) if (f.artistId) artistScore.set(f.artistId, (artistScore.get(f.artistId) ?? 0) + Math.max(0, p.trackSignal.get(f.id) ?? 0) * 2 + 0.05 + r() * 0.05);
  const topArtists = [...artistScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id);
  const artistMap = new Map(queryArtists(userId, `WHERE ar.id IN (${topArtists.map((_, i) => '@y' + i).join(',') || "''"}) AND ar.name NOT LIKE 'Unknown%'`, Object.fromEntries(topArtists.map((id, i) => ['y' + i, id]))).map((a) => [a.id, a]));
  const artists = topArtists.map((id) => artistMap.get(id)).filter((a): a is Artist => !!a).slice(0, 16);

  const moods = MOODS.map((m) => {
    const mix = moodMix(userId, m, 8, ex);
    return { id: m.id, label: m.label, blurb: m.blurb, gradient: m.gradient, covers: mix.covers, n: mix.tracks.length };
  })
    .filter((m) => m.n >= 5)
    .map(({ n: _n, ...m }) => m);

  return {
    stats, hasHistory, quick, recent: recentTracks(userId, 20), recentContexts, mixes, discover, added, albums, artists, moods, forgotten,
    order: settings.homeOrder,
  };
}

/* ------------------------------------------------------------------ stats */

export function stats(userId: string, range: '4w' | '6m' | '1y' | 'all', year?: number) {
  let from = 0;
  let to = now();
  if (year) {
    from = new Date(year, 0, 1).getTime();
    to = new Date(year + 1, 0, 1).getTime();
  } else if (range === '4w') from = now() - 28 * 86_400_000;
  else if (range === '6m') from = now() - 182 * 86_400_000;
  else if (range === '1y') from = now() - 365 * 86_400_000;
  const ev = db
    .prepare(`SELECT e.track_id, e.ms_played, e.completed, e.skipped, e.created_at, t.artist_id, t.genre FROM play_events e JOIN tracks t ON t.id = e.track_id WHERE e.user_id = ? AND e.created_at >= ? AND e.created_at < ?`)
    .all(userId, from, to) as { track_id: string; ms_played: number; completed: number; skipped: number; created_at: number; artist_id: string | null; genre: string | null }[];
  const minutes = Math.round(ev.reduce((a, e) => a + e.ms_played, 0) / 60000);
  const trackPlays = new Map<string, { n: number; ms: number }>();
  const artistPlays = new Map<string, { n: number; ms: number }>();
  const famPlays = new Map<string, number>();
  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  const months = new Array(12).fill(0);
  const days = new Map<string, number>();
  let skips = 0;
  for (const e of ev) {
    if (e.skipped) skips++;
    const counted = !e.skipped && (e.completed || e.ms_played > 30000);
    const d = new Date(e.created_at);
    hours[d.getHours()] += e.ms_played / 60000;
    weekdays[d.getDay()] += e.ms_played / 60000;
    months[d.getMonth()] += e.ms_played / 60000;
    const dk = d.toISOString().slice(0, 10);
    days.set(dk, (days.get(dk) ?? 0) + e.ms_played / 60000);
    if (!counted) continue;
    const tp = trackPlays.get(e.track_id) ?? { n: 0, ms: 0 };
    tp.n++;
    tp.ms += e.ms_played;
    trackPlays.set(e.track_id, tp);
    if (e.artist_id) {
      const ap = artistPlays.get(e.artist_id) ?? { n: 0, ms: 0 };
      ap.n++;
      ap.ms += e.ms_played;
      artistPlays.set(e.artist_id, ap);
    }
    const fam = familiesOf(e.genre)[0];
    if (fam) famPlays.set(fam.id, (famPlays.get(fam.id) ?? 0) + 1);
  }
  const topTrackIds = [...trackPlays.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 50);
  const topTracks = tracksByIds(userId, topTrackIds.map(([id]) => id)).map((t) => ({ track: t, plays: trackPlays.get(t.id)!.n, minutes: Math.round(trackPlays.get(t.id)!.ms / 60000) }));
  const topArtistIds = [...artistPlays.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 30);
  const artistMap = new Map(queryArtists(userId, `WHERE ar.id IN (${topArtistIds.map((_, i) => '@z' + i).join(',') || "''"})`, Object.fromEntries(topArtistIds.map(([id], i) => ['z' + i, id]))).map((a) => [a.id, a]));
  const topArtists = topArtistIds
    .map(([id, v]) => ({ artist: artistMap.get(id)!, plays: v.n, minutes: Math.round(v.ms / 60000) }))
    .filter((x) => x.artist);
  const totalFam = [...famPlays.values()].reduce((a, b) => a + b, 0) || 1;
  const topGenres = [...famPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, n]) => ({ id, label: familyById(id).label, color: familyById(id).color, plays: n, share: n / totalFam }));
  // streak
  let streak = 0;
  let best = 0;
  let cur = 0;
  const sortedDays = [...days.keys()].sort();
  let prev: number | null = null;
  for (const dk of sortedDays) {
    const t = new Date(dk).getTime();
    cur = prev != null && t - prev === 86_400_000 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = t;
  }
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(now() - 86_400_000).toISOString().slice(0, 10);
  if (days.has(today) || days.has(yest)) streak = cur;
  const topDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const firstEvent = ev.length ? ev.reduce((a, e) => (e.created_at < a.created_at ? e : a)) : null;
  const firstTrack = firstEvent ? tracksByIds(userId, [firstEvent.track_id])[0] ?? null : null;
  const distinctArtists = artistPlays.size;
  const distinctTracks = trackPlays.size;
  const peakHour = hours.indexOf(Math.max(...hours));
  const persona =
    ev.length < 5
      ? null
      : distinctArtists > 60 && topArtists[0] && topArtists[0].minutes < minutes * 0.08
        ? { title: 'The Explorer', blurb: 'You roam widely — no single artist holds you for long.' }
        : topArtists[0] && topArtists[0].minutes > minutes * 0.25
          ? { title: 'The Devotee', blurb: `When you love an artist, you go all in. ${topArtists[0].artist.name} knows.` }
          : peakHour >= 22 || peakHour <= 3
            ? { title: 'The Night Owl', blurb: 'Your listening peaks while the world sleeps.' }
            : skips / Math.max(1, ev.length) > 0.35
              ? { title: 'The Curator', blurb: 'You know exactly what you want — and skip the rest.' }
              : { title: 'The Loyalist', blurb: 'You keep your favourites close and play them often.' };
  return {
    range, year: year ?? null, from, to, minutes, plays: ev.length, skips, distinctArtists, distinctTracks,
    topTracks, topArtists, topGenres, hours: hours.map((h) => Math.round(h)), weekdays: weekdays.map((h) => Math.round(h)), months: months.map((h) => Math.round(h)),
    streak, bestStreak: best, topDay: topDay ? { date: topDay[0], minutes: Math.round(topDay[1]) } : null, firstTrack, peakHour: ev.length ? peakHour : null, persona,
    activeDays: days.size,
  };
}

export { queryTracks };
