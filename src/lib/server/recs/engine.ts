import 'server-only';
import { db, now } from '../db';
import { tracksByIds } from '../catalog';
import { familiesOf, familyById, FAMILIES, MOODS, type MoodDef } from './lexicon';
import type { Mix, Track } from '../../types';

/* ------------------------------------------------------------------ feature index */

export interface Feat {
  id: string;
  artistId: string | null;
  albumId: string | null;
  genre: string | null;
  fams: string[];
  year: number | null;
  energy: number; // measured or genre prior
  bpm: number;
  bright: number;
  measured: boolean;
  explicit: boolean;
  addedAt: number;
  cover: boolean;
  kind: string;
}

interface Index {
  stamp: string;
  at: number;
  feats: Feat[];
  byId: Map<string, Feat>;
}
const g = globalThis as unknown as { __auroraIdx?: Index };

function stamp() {
  const r = db
    .prepare(
      `SELECT count(*) c, max(added_at) m, (SELECT count(*) FROM tracks WHERE features_at IS NOT NULL) f, (SELECT count(*) FROM tracks WHERE genre IS NOT NULL) gc,
        (SELECT count(*) FROM likes) lk, (SELECT count(*) FROM playlist_tracks) pt,
        (SELECT count(*) FROM track_copies WHERE playable = 1) pc, (SELECT max(rowid) FROM play_events) pe FROM tracks`,
    )
    .get() as { c: number; m: number | null; f: number; gc: number; lk: number; pt: number; pc: number; pe: number | null };
  return `${r.c}:${r.m}:${r.f}:${r.gc}:${r.lk}:${r.pt}:${r.pc}:${r.pe}`;
}

export function index(): Index {
  const cur = g.__auroraIdx;
  if (cur && now() - cur.at < 3_000) return cur;
  const s = stamp();
  if (cur && cur.stamp === s) {
    cur.at = now();
    return cur;
  }
  const rows = db
    .prepare(
      `SELECT t.id, t.artist_id, t.album_id, t.genre, t.year, t.energy, t.bpm, t.brightness, t.explicit, t.added_at, t.kind,
        (COALESCE(t.cover, al.cover) IS NOT NULL) AS has_cover,
        (SELECT ar.tags FROM artists ar WHERE ar.id = t.artist_id) AS artist_tags
       FROM tracks t LEFT JOIN albums al ON al.id = t.album_id
       WHERE EXISTS (SELECT 1 FROM track_copies c WHERE c.track_id = t.id AND c.playable = 1)`,
    )
    .all() as {
      id: string; artist_id: string | null; album_id: string | null; genre: string | null; year: number | null; energy: number | null; bpm: number | null;
      brightness: number | null; explicit: number; added_at: number; kind: string; has_cover: number; artist_tags: string | null;
    }[];
  const feats: Feat[] = rows.map((r) => {
    let tags: string[] = [];
    try {
      tags = r.artist_tags ? JSON.parse(r.artist_tags) : [];
    } catch {}
    const fams = [...new Set([...familiesOf(r.genre), ...tags.slice(0, 3).flatMap((t) => familiesOf(t))].map((f) => f.id))].slice(0, 3);
    const prior = fams.length ? fams.map(familyById) : [];
    const avg = (k: 'energy' | 'bpm' | 'bright', d: number) => (prior.length ? prior.reduce((a, f) => a + f[k], 0) / prior.length : d);
    const measured = r.energy != null;
    return {
      id: r.id, artistId: r.artist_id, albumId: r.album_id, genre: r.genre, fams, year: r.year,
      energy: measured ? r.energy! * 0.75 + avg('energy', 0.5) * 0.25 : avg('energy', 0.5),
      bpm: r.bpm ?? avg('bpm', 110), bright: r.brightness ?? avg('bright', 0.5), measured,
      explicit: !!r.explicit, addedAt: r.added_at, cover: !!r.has_cover, kind: r.kind,
    };
  });
  const idx = { stamp: s, at: now(), feats, byId: new Map(feats.map((f) => [f.id, f])) };
  g.__auroraIdx = idx;
  return idx;
}

/* ------------------------------------------------------------------ taste profile */

export interface Profile {
  weights: Map<string, number>; // sparse feature → weight (a:artist, f:family, d:decade, al:album)
  trackSignal: Map<string, number>;
  playCount: Map<string, number>;
  lastPlayed: Map<string, number>;
  skips: Map<string, number>;
  energy: number;
  bpm: number;
  bright: number;
  strength: number; // how much signal we have
}

const HALF_LIFE = 30 * 86_400_000;
const decay = (t: number) => Math.pow(0.5, (now() - t) / HALF_LIFE);

function featKeys(f: Feat): [string, number][] {
  const k: [string, number][] = [];
  if (f.artistId) k.push(['a:' + f.artistId, 1]);
  if (f.albumId) k.push(['al:' + f.albumId, 0.4]);
  f.fams.forEach((fam, i) => k.push(['f:' + fam, i === 0 ? 0.9 : 0.5]));
  if (f.year) k.push(['d:' + Math.floor(f.year / 10) * 10, 0.35]);
  return k;
}

const profCache = new Map<string, { at: number; p: Profile }>();

export function profile(userId: string): Profile {
  const c = profCache.get(userId);
  if (c && now() - c.at < 15_000) return c.p;
  const idx = index();
  const signal = new Map<string, number>();
  const plays = new Map<string, number>();
  const last = new Map<string, number>();
  const skips = new Map<string, number>();
  const add = (id: string, v: number) => signal.set(id, (signal.get(id) ?? 0) + v);

  const events = db
    .prepare('SELECT track_id, ms_played, completed, skipped, created_at FROM play_events WHERE user_id = ? AND created_at > ? ORDER BY created_at')
    .all(userId, now() - 365 * 86_400_000) as { track_id: string; ms_played: number; completed: number; skipped: number; created_at: number }[];
  for (const e of events) {
    const d = decay(e.created_at);
    if (e.skipped) {
      add(e.track_id, -2 * d);
      skips.set(e.track_id, (skips.get(e.track_id) ?? 0) + 1);
    } else if (e.completed) {
      const prior = plays.get(e.track_id) ?? 0;
      add(e.track_id, (prior > 0 ? 1.5 : 1) * d);
      plays.set(e.track_id, prior + 1);
    } else if (e.ms_played > 30_000) {
      add(e.track_id, 0.5 * d);
      plays.set(e.track_id, (plays.get(e.track_id) ?? 0) + 0.5);
    }
    last.set(e.track_id, e.created_at);
  }
  for (const r of db.prepare('SELECT track_id, created_at FROM likes WHERE user_id = ?').all(userId) as { track_id: string; created_at: number }[]) add(r.track_id, 3);
  for (const r of db
    .prepare(`SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE (p.owner_id = ? AND p.origin IS NULL) OR pt.added_by = ?`)
    .all(userId, userId) as { track_id: string }[])
    add(r.track_id, 2);
  for (const r of db.prepare('SELECT t.id FROM saved_albums s JOIN tracks t ON t.album_id = s.album_id WHERE s.user_id = ?').all(userId) as { id: string }[]) add(r.id, 1.5);

  const weights = new Map<string, number>();
  let eSum = 0, bSum = 0, brSum = 0, wSum = 0;
  for (const [id, v] of signal) {
    const f = idx.byId.get(id);
    if (!f) continue;
    for (const [k, w] of featKeys(f)) weights.set(k, (weights.get(k) ?? 0) + v * w);
    if (v > 0) {
      eSum += f.energy * v;
      bSum += f.bpm * v;
      brSum += f.bright * v;
      wSum += v;
    }
  }
  for (const r of db.prepare('SELECT artist_id FROM followed_artists WHERE user_id = ?').all(userId) as { artist_id: string }[]) {
    weights.set('a:' + r.artist_id, (weights.get('a:' + r.artist_id) ?? 0) + 2);
  }
  // L2-normalise sparse weights
  let norm2 = 0;
  for (const v of weights.values()) norm2 += v * v;
  const n = Math.sqrt(norm2) || 1;
  for (const [k, v] of weights) weights.set(k, v / n);
  const p: Profile = {
    weights, trackSignal: signal, playCount: plays, lastPlayed: last, skips,
    energy: wSum ? eSum / wSum : 0.5, bpm: wSum ? bSum / wSum : 110, bright: wSum ? brSum / wSum : 0.5, strength: wSum,
  };
  profCache.set(userId, { at: now(), p });
  return p;
}
export function invalidateProfile(userId: string) {
  profCache.delete(userId);
}

export function affinity(p: Profile, f: Feat): number {
  let s = 0;
  let fn = 0;
  for (const [k, w] of featKeys(f)) {
    s += (p.weights.get(k) ?? 0) * w;
    fn += w * w;
  }
  const cos = s / (Math.sqrt(fn) || 1);
  const numeric = 1 - Math.min(1, Math.abs(f.energy - p.energy) * 1.4) * 0.6 - Math.min(1, Math.abs(f.bpm - p.bpm) / 80) * 0.4;
  return cos + (p.strength > 2 ? numeric * 0.15 : 0);
}

/* ------------------------------------------------------------------ utils */

export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Pick from ranked candidates with an artist diversity cap and spacing so the same artist never plays back-to-back. */
export function diversify(ranked: Feat[], count: number, perArtist = 3): Feat[] {
  const out: Feat[] = [];
  const counts = new Map<string, number>();
  for (const f of ranked) {
    const a = f.artistId ?? f.id;
    if ((counts.get(a) ?? 0) >= perArtist) continue;
    counts.set(a, (counts.get(a) ?? 0) + 1);
    out.push(f);
    if (out.length >= count) break;
  }
  // spacing pass
  for (let i = 1; i < out.length; i++) {
    if (out[i].artistId && out[i].artistId === out[i - 1].artistId) {
      const j = out.findIndex((x, k) => k > i && x.artistId !== out[i].artistId && x.artistId !== out[i - 1].artistId);
      if (j > 0) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

const gauss = (x: number, [lo, hi]: [number, number]) => {
  if (x >= lo && x <= hi) return 1;
  const d = x < lo ? lo - x : x - hi;
  return Math.exp(-(d * d) / 0.02);
};

export interface Target {
  energy?: [number, number];
  bpm?: [number, number];
  bright?: [number, number];
  prefer?: string[];
  avoid?: string[];
  instrumental?: boolean;
}

export function targetScore(f: Feat, t: Target): number {
  let s = 0;
  let w = 0;
  if (t.energy) {
    s += gauss(f.energy, t.energy) * 2;
    w += 2;
  }
  if (t.bpm && f.bpm) {
    const ok = gauss(f.bpm / 100, [t.bpm[0] / 100, t.bpm[1] / 100]) || gauss(f.bpm / 50, [t.bpm[0] / 100, t.bpm[1] / 100]);
    s += ok;
    w += 1;
  }
  if (t.bright) {
    s += gauss(f.bright, t.bright) * 0.6;
    w += 0.6;
  }
  let base = w ? s / w : 0.5;
  if (t.prefer?.length) {
    const hit = f.fams.some((x) => t.prefer!.includes(x));
    base = base * 0.55 + (hit ? 0.45 : f.fams.length ? 0 : 0.15);
  }
  if (t.avoid?.some((x) => f.fams.includes(x))) base *= 0.15;
  if (t.instrumental) {
    const inst = f.fams.some((x) => familyById(x).instrumental);
    base *= inst ? 1.15 : 0.6;
  }
  return base;
}

function filterFeats(userId: string, opts: { explicitFilter?: boolean } = {}) {
  const idx = index();
  return idx.feats.filter((f) => f.kind === 'music' && (!opts.explicitFilter || !f.explicit));
}

function toMix(userId: string, m: Omit<Mix, 'tracks' | 'covers'> & { ids: string[] }): Mix {
  const tracks = tracksByIds(userId, m.ids);
  const covers: string[] = [];
  for (const t of tracks) if (t.cover && !covers.includes(t.cover)) covers.push(t.cover);
  const { ids: _ids, ...rest } = m;
  return { ...rest, tracks, covers: covers.slice(0, 4) };
}

const dayKey = () => new Date().toISOString().slice(0, 10);
const weekKey = () => {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-w${Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)}`;
};

/* ------------------------------------------------------------------ mixes */

export function dailyMixes(userId: string, explicitFilter = false): Mix[] {
  const p = profile(userId);
  const feats = filterFeats(userId, { explicitFilter });
  if (feats.length < 8) return [];
  const r = rng(userId + dayKey());
  // Rank families by taste weight; cold start: by library size
  const famScore = new Map<string, number>();
  for (const f of feats) for (const fam of f.fams) famScore.set(fam, (famScore.get(fam) ?? 0) + (p.strength > 2 ? Math.max(0, p.trackSignal.get(f.id) ?? 0) + 0.02 : 1));
  if (p.strength > 2) for (const [k, v] of p.weights) if (k.startsWith('f:')) famScore.set(k.slice(2), (famScore.get(k.slice(2)) ?? 0) + v * 50);
  // Group small genres together so modest libraries still get several mixes
  const minPool = Math.max(4, Math.min(12, Math.round(feats.length / 8)));
  const ranked = [...famScore.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const groups: string[][] = [];
  let pending: string[] = [];
  let pendingSize = 0;
  for (const fam of ranked) {
    const size = feats.filter((f) => f.fams.includes(fam)).length;
    if (size >= minPool) groups.push([fam]);
    else {
      pending.push(fam);
      pendingSize += size;
      if (pendingSize >= minPool) {
        groups.push(pending);
        pending = [];
        pendingSize = 0;
      }
    }
  }
  if (pending.length && groups.length) groups[groups.length - 1].push(...pending);
  const mixes: Mix[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    if (mixes.length >= 6) break;
    const fam = group[0];
    const pool = feats.filter((f) => f.fams.some((x) => group.includes(x)));
    if (pool.length < 4) continue;
    const scored = pool.map((f) => {
      const sig = p.trackSignal.get(f.id) ?? 0;
      const familiar = sig > 0 ? 0.6 + Math.min(1, sig / 4) * 0.4 : 0;
      const skipPenalty = (p.skips.get(f.id) ?? 0) * 0.25;
      return { f, s: affinity(p, f) + familiar * 0.6 - skipPenalty + r() * 0.35 - (used.has(f.id) ? 1 : 0) };
    });
    scored.sort((a, b) => b.s - a.s);
    const picked = diversify(scored.map((x) => x.f), 40, 4);
    picked.forEach((f) => used.add(f.id));
    const fdef = familyById(fam);
    const label = group.map((g) => familyById(g).label).slice(0, 2).join(' & ');
    const artistNames = db
      .prepare(`SELECT name FROM artists WHERE id IN (${[...new Set(picked.map((x) => x.artistId).filter(Boolean))].slice(0, 3).map(() => '?').join(',') || "''"})`)
      .all(...[...new Set(picked.map((x) => x.artistId).filter(Boolean))].slice(0, 3)) as { name: string }[];
    mixes.push(
      toMix(userId, {
        id: `daily-${mixes.length + 1}`, kind: 'daily', title: `Daily Mix ${mixes.length + 1}`,
        subtitle: `${label} · ${artistNames.map((a) => a.name).join(', ')}${artistNames.length ? ' and more' : ''}`, color: fdef.color, ids: picked.map((f) => f.id),
      }),
    );
  }
  return mixes;
}

export function discoverWeekly(userId: string, explicitFilter = false): Mix | null {
  const p = profile(userId);
  const r = rng(userId + weekKey());
  const fresh = filterFeats(userId, { explicitFilter }).filter((f) => (p.playCount.get(f.id) ?? 0) < 1 && !(p.trackSignal.get(f.id) ?? 0));
  if (fresh.length < 5) return null;
  const scored = fresh.map((f) => ({ f, s: affinity(p, f) + r() * (p.strength > 2 ? 0.4 : 1) + (f.cover ? 0.05 : 0) }));
  scored.sort((a, b) => b.s - a.s);
  // 85% exploit, 15% explore (random picks from outside the top)
  const top = diversify(scored.map((x) => x.f), 26, 2);
  const rest = scored.slice(80).map((x) => x.f).filter((f) => !top.includes(f));
  for (let i = 0; i < 4 && rest.length; i++) top.splice(Math.floor(r() * top.length), 0, rest.splice(Math.floor(r() * rest.length), 1)[0]);
  return toMix(userId, { id: 'discover', kind: 'discover', title: 'Discover Weekly', subtitle: 'Music from your library you haven’t heard yet, picked for you. Refreshes every Monday.', color: '#5f7bff', ids: top.map((f) => f.id) });
}

export function onRepeat(userId: string): Mix | null {
  const rows = db
    .prepare(`SELECT track_id, count(*) c FROM play_events WHERE user_id = ? AND created_at > ? AND skipped = 0 AND (completed = 1 OR ms_played > 30000) GROUP BY track_id HAVING c >= 2 ORDER BY c DESC LIMIT 30`)
    .all(userId, now() - 30 * 86_400_000) as { track_id: string }[];
  if (rows.length < 3) return null;
  return toMix(userId, { id: 'onrepeat', kind: 'onrepeat', title: 'On Repeat', subtitle: 'The songs you can’t stop playing this month.', color: '#ff5c8a', ids: rows.map((r) => r.track_id) });
}

export function forgottenFavorites(userId: string): Mix | null {
  const p = profile(userId);
  const cutoff = now() - 45 * 86_400_000;
  const liked = new Set((db.prepare('SELECT track_id FROM likes WHERE user_id = ?').all(userId) as { track_id: string }[]).map((r) => r.track_id));
  const cands = [...p.trackSignal.entries()]
    .filter(([id, s]) => (s > 1.5 || liked.has(id)) && (p.lastPlayed.get(id) ?? 0) < cutoff)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .slice(0, 40);
  if (cands.length < 5) return null;
  return toMix(userId, { id: 'forgotten', kind: 'forgotten', title: 'Forgotten Favorites', subtitle: 'Songs you loved but haven’t played in a while.', color: '#e7a34c', ids: cands });
}

export function moodMix(userId: string, mood: MoodDef, count = 50, explicitFilter = false): Mix {
  const p = profile(userId);
  const r = rng(userId + mood.id + dayKey());
  const scored = filterFeats(userId, { explicitFilter }).map((f) => ({
    f,
    s: targetScore(f, { energy: mood.energy, bpm: mood.bpm, bright: mood.bright, prefer: mood.prefer, avoid: mood.avoid }) + affinity(p, f) * 0.35 + r() * 0.15 - (p.skips.get(f.id) ?? 0) * 0.2,
  }));
  scored.sort((a, b) => b.s - a.s);
  const picked = diversify(scored.filter((x) => x.s > 0.35).map((x) => x.f), count, 3);
  return toMix(userId, { id: `mood-${mood.id}`, kind: 'mood', title: mood.label, subtitle: mood.blurb, color: mood.gradient[0], ids: picked.map((f) => f.id) });
}

export function moodCounts(userId: string) {
  return MOODS.map((m) => ({ ...m, available: moodMix(userId, m, 12).tracks.length }));
}

/** Radio from a track or artist seed: similar features + a little taste. */
export function radio(userId: string, seed: { trackId?: string; artistId?: string }, count = 50, exclude: string[] = [], explicitFilter = false): Track[] {
  const idx = index();
  const p = profile(userId);
  const ex = new Set(exclude);
  let seedFeats: Feat[] = [];
  if (seed.trackId) {
    const f = idx.byId.get(seed.trackId);
    if (f) seedFeats = [f];
  }
  if (seed.artistId) seedFeats = idx.feats.filter((f) => f.artistId === seed.artistId);
  if (!seedFeats.length) return [];
  // centroid
  const w = new Map<string, number>();
  let e = 0, b = 0, br = 0;
  for (const f of seedFeats) {
    for (const [k, v] of featKeys(f)) w.set(k, (w.get(k) ?? 0) + v / seedFeats.length);
    e += f.energy / seedFeats.length;
    b += f.bpm / seedFeats.length;
    br += f.bright / seedFeats.length;
  }
  const seedArtist = seedFeats[0].artistId;
  const r = rng(JSON.stringify(seed) + dayKey() + exclude.length);
  const scored = filterFeats(userId, { explicitFilter })
    .filter((f) => !ex.has(f.id) && f.id !== seed.trackId)
    .map((f) => {
      let s = 0;
      for (const [k, v] of featKeys(f)) s += (w.get(k) ?? 0) * v;
      const famHit = f.fams.some((x) => seedFeats[0].fams.includes(x)) ? 0.4 : 0;
      const numeric = 1 - Math.min(1, Math.abs(f.energy - e) * 1.6) * 0.6 - Math.min(1, Math.abs(f.bpm - b) / 60) * 0.3 - Math.abs(f.bright - br) * 0.1;
      const sameArtist = f.artistId && f.artistId === seedArtist ? (seed.artistId ? 0.6 : 0.35) : 0;
      return { f, s: s * 0.5 + famHit + numeric * 0.5 + sameArtist + affinity(p, f) * 0.2 - (p.skips.get(f.id) ?? 0) * 0.3 + r() * 0.2 };
    });
  scored.sort((x, y) => y.s - x.s);
  const picked = diversify(scored.map((x) => x.f), count, seed.artistId ? 8 : 3);
  return tracksByIds(userId, picked.map((f) => f.id));
}

/** Smart autoplay: continue from what's been playing recently. */
export function autoplay(userId: string, recent: string[], count = 20, explicitFilter = false): Track[] {
  const idx = index();
  const seeds = recent.map((id) => idx.byId.get(id)).filter((f): f is Feat => !!f).slice(-5);
  if (!seeds.length) {
    const d = dailyMixes(userId, explicitFilter)[0];
    return d ? d.tracks.slice(0, count) : [];
  }
  const p = profile(userId);
  const ex = new Set(recent);
  const r = rng(recent.join(',') + count);
  const scored = filterFeats(userId, { explicitFilter })
    .filter((f) => !ex.has(f.id))
    .map((f) => {
      let s = 0;
      for (const sf of seeds) {
        const famHit = f.fams.some((x) => sf.fams.includes(x)) ? 0.5 : 0;
        const artist = f.artistId === sf.artistId ? 0.25 : 0;
        s += famHit + artist + (1 - Math.min(1, Math.abs(f.energy - sf.energy) * 1.5)) * 0.4;
      }
      return { f, s: s / seeds.length + affinity(p, f) * 0.3 - (p.skips.get(f.id) ?? 0) * 0.3 + r() * 0.25 };
    });
  scored.sort((a, b) => b.s - a.s);
  return tracksByIds(userId, diversify(scored.map((x) => x.f), count, 2).map((f) => f.id));
}

export function genreFamiliesInLibrary() {
  const idx = index();
  const counts = new Map<string, number>();
  for (const f of idx.feats) for (const fam of f.fams.slice(0, 1)) counts.set(fam, (counts.get(fam) ?? 0) + 1);
  return FAMILIES.filter((f) => counts.get(f.id)).map((f) => ({ ...f, match: undefined, count: counts.get(f.id)! })).sort((a, b) => b.count - a.count);
}

export function familyTracks(userId: string, famId: string, limit = 200): Track[] {
  const p = profile(userId);
  const ids = index()
    .feats.filter((f) => f.fams.includes(famId))
    .map((f) => ({ f, s: affinity(p, f) + Math.random() * 0.1 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.f.id);
  return tracksByIds(userId, ids);
}
