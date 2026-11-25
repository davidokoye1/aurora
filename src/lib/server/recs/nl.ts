import 'server-only';
import { db, norm } from '../db';
import { tracksByIds } from '../catalog';
import { FAMILIES, INTENTS, familyById } from './lexicon';
import { index, profile, affinity, targetScore, diversify, rng, type Target, type Feat } from './engine';
import type { Track } from '../../types';

export interface Chip {
  kind: 'mood' | 'genre' | 'era' | 'artist' | 'tempo' | 'length' | 'exclude' | 'filter' | 'taste';
  label: string;
}

export interface NLResult {
  title: string;
  description: string;
  chips: Chip[];
  tracks: Track[];
}

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, half: 0.5 };

export interface ParsedPrompt {
  target: Target;
  chips: Chip[];
  years: [number, number] | null;
  recent: boolean;
  artistIds: string[];
  excludeFams: string[];
  count: number;
  minutes: number | null;
  clean: boolean;
  arc: 'rise' | 'fall' | 'steady' | null;
  genreWords: string[];
}

/** Parse a natural-language request into scoring targets. Pure apart from the artist lookup. */
export function parsePrompt(prompt: string, artistLookup: (q: string) => { id: string; name: string }[] = () => []): ParsedPrompt {
  const text = ' ' + prompt.toLowerCase().replace(/[’']/g, "'") + ' ';
  const chips: Chip[] = [];
  const target: Target = {};
  const prefer = new Set<string>();
  const avoid = new Set<string>();
  let arc: ParsedPrompt['arc'] = null;
  const energies: [number, number][] = [];

  // Exclusions first: "no rap", "without metal", "not too loud", "except country"
  const excludeFams: string[] = [];
  let stripped = text;
  for (const m of text.matchAll(/\b(?:no|without|not|except|minus|skip|avoid|zero)\s+(?:any\s+)?([a-z&\- ]{2,24}?)(?=[,.;!?]| and | but | or |$| for | with )/g)) {
    const phrase = m[1].trim();
    const fams = FAMILIES.filter((f) => f.match.test(phrase) || f.label.toLowerCase().includes(phrase));
    if (fams.length) {
      fams.forEach((f) => {
        avoid.add(f.id);
        excludeFams.push(f.id);
      });
      chips.push({ kind: 'exclude', label: `no ${phrase}` });
      stripped = stripped.replace(m[0], ' ');
    }
  }

  for (const it of INTENTS) {
    if (it.re.test(stripped)) {
      chips.push({ kind: it.label.includes('energy') ? 'tempo' : 'mood', label: it.label });
      if (it.energy) energies.push(it.energy);
      if (it.bpm) target.bpm = target.bpm ? [Math.max(target.bpm[0], it.bpm[0]), Math.min(target.bpm[1], it.bpm[1])] : it.bpm;
      if (it.bright) target.bright = it.bright;
      it.prefer?.forEach((p) => prefer.add(p));
      it.avoid?.forEach((p) => avoid.add(p));
      if (it.instrumental) target.instrumental = true;
      if (it.arc) arc = it.arc;
    }
  }
  if (energies.length) {
    const lo = energies.reduce((a, e) => a + e[0], 0) / energies.length;
    const hi = energies.reduce((a, e) => a + e[1], 0) / energies.length;
    target.energy = [lo, Math.max(lo + 0.15, hi)];
  }
  if (target.bpm && target.bpm[0] > target.bpm[1]) target.bpm = undefined;

  // Genres mentioned explicitly take priority over mood-implied genres
  const genreWords: string[] = [];
  const explicitFams: string[] = [];
  for (const f of FAMILIES) {
    if (excludeFams.includes(f.id)) continue;
    const labelWords = f.label.toLowerCase().split(/ & | and |\s*\/\s*/);
    if (f.match.test(stripped.replace(/\b(rap|rock)\s+(music|songs)\b/g, '$1')) || labelWords.some((w) => stripped.includes(' ' + w + ' '))) {
      // avoid false positives from very generic words inside other words
      const m = stripped.match(f.match);
      const word = m?.[0]?.trim();
      if (word && word.length < 3) continue;
      if (f.id === 'electronic' && /\b(drum|house|techno|synthwave|trance|dubstep)\b/.test(stripped)) continue;
      if (f.id === 'world' && !/\bworld\b|traditional|bollywood|indian|arabic|turkish|balkan|african/.test(stripped)) continue;
      if (f.id === 'soundtrack' && /\bgame\b/.test(stripped) && !/\b(soundtrack|ost|score|video game music|game music)\b/.test(stripped)) continue;
      if (f.id === 'trance' && !/\btrance|psy|goa\b/.test(stripped)) continue;
      if (f.id === 'lofi' && /\bchill\b/.test(stripped) && !/lo-?fi|chillhop|downtempo|trip ?hop|beats/.test(stripped)) continue;
      if (f.id === 'spoken' && !/spoken|audiobook|comedy|podcast|poetry|lecture/.test(stripped)) continue;
      if (f.id === 'rock' && /\bpost-?rock\b/.test(stripped) && !/\b(rock)\b(?!.*post)/.test(stripped.replace(/post-?rock/g, ''))) continue;
      if (f.id === 'punk' && /post-?punk/.test(stripped) && !/\bpunk\b/.test(stripped.replace(/post-?punk/g, ''))) continue;
      if (f.id === 'house' && /\bdance\b/.test(stripped) && !/house|disco|garage|edm|club/.test(stripped)) continue;
      if (f.id === 'pop' && /\bk-?pop|j-?pop\b/.test(stripped) === false && !/\bpop\b/.test(stripped)) continue;
      explicitFams.push(f.id);
      genreWords.push(word ?? f.label);
    }
  }
  if (explicitFams.length) {
    prefer.clear();
    explicitFams.forEach((f) => prefer.add(f));
    for (const f of explicitFams) chips.push({ kind: 'genre', label: familyById(f).label });
  }

  // Eras
  let years: [number, number] | null = null;
  const dec = /\b(?:the\s+)?(?:(19|20)?(\d)0)'?s\b/.exec(stripped);
  if (dec) {
    const century = dec[1] ? Number(dec[1]) * 100 : Number(dec[2]) >= 3 ? 1900 : 2000;
    const start = century + Number(dec[2]) * 10;
    years = [start, start + 9];
    chips.push({ kind: 'era', label: `${start}s` });
  } else if (/\b(oldies|classic hits|vintage|old school)\b/.test(stripped)) {
    years = [1950, 1989];
    chips.push({ kind: 'era', label: 'classics' });
  }
  const yr = /\b(?:from|in)\s+((?:19|20)\d{2})\b/.exec(stripped);
  if (yr && !years) {
    years = [Number(yr[1]), Number(yr[1])];
    chips.push({ kind: 'era', label: yr[1] });
  }
  const recent = /\b(new|newest|latest|recent|fresh|just added|recently added)\b/.test(stripped);
  if (recent) chips.push({ kind: 'filter', label: 'recently added' });

  // Length
  let count = 30;
  let minutes: number | null = null;
  const len = /\b(\d+|a|an|one|two|three|half)\s*(?:an?\s+)?(hours?|hrs?|h|minutes?|mins?|songs?|tracks?)\b/.exec(stripped);
  if (len) {
    const n = NUM_WORDS[len[1]] ?? Number(len[1]);
    if (/^h/.test(len[2])) minutes = Math.round(n * 60);
    else if (/^m/.test(len[2])) minutes = n;
    else count = Math.max(5, Math.min(200, n));
    chips.push({ kind: 'length', label: minutes ? `${minutes} min` : `${count} tracks` });
  }
  if (/\b(hour|an hour)\b/.test(stripped) && !minutes && !len) {
    minutes = 60;
    chips.push({ kind: 'length', label: '60 min' });
  }

  const clean = /\b(clean|no explicit|family[- ]friendly|kid[- ]friendly|for kids|safe for work|sfw)\b/.test(stripped);
  if (clean) chips.push({ kind: 'filter', label: 'clean only' });

  // Artists: "like X", "similar to X", "X vibes", or any artist name in the library mentioned verbatim
  const artistIds: string[] = [];
  const cand = new Set<string>();
  for (const m of stripped.matchAll(/\b(?:like|similar to|sounds like|in the style of|inspired by|vibes? of|such as|by)\s+([a-z0-9&'.\- ]{2,40}?)(?=[,.;!?]| and | or | for | with | but |$)/g)) cand.add(m[1].trim());
  for (const m of stripped.matchAll(/\b([a-z0-9&'.\- ]{2,40}?)\s+(?:vibes?|style|type beat|radio)\b/g)) cand.add(m[1].trim());
  for (const c of cand) {
    for (const a of artistLookup(c).slice(0, 2)) {
      if (!artistIds.includes(a.id)) {
        artistIds.push(a.id);
        chips.push({ kind: 'artist', label: a.name });
      }
    }
  }
  if (!artistIds.length) {
    for (const a of artistLookup('\u0000all-in:' + stripped)) {
      if (!artistIds.includes(a.id)) {
        artistIds.push(a.id);
        chips.push({ kind: 'artist', label: a.name });
      }
    }
  }

  if (prefer.size) target.prefer = [...prefer];
  if (avoid.size) target.avoid = [...avoid];
  return { target, chips, years, recent, artistIds, excludeFams, count, minutes, clean, arc, genreWords };
}

function lookupArtists(q: string): { id: string; name: string }[] {
  if (q.startsWith('\u0000all-in:')) {
    const text = ' ' + norm(q.slice(8)) + ' ';
    const rows = db.prepare("SELECT id, name, norm FROM artists WHERE length(norm) >= 4 AND name NOT LIKE 'Unknown%'").all() as { id: string; name: string; norm: string }[];
    return rows.filter((r) => text.includes(' ' + r.norm + ' ')).slice(0, 3);
  }
  const n = norm(q);
  if (n.length < 2) return [];
  const exact = db.prepare('SELECT id, name FROM artists WHERE norm = ?').all(n) as { id: string; name: string }[];
  if (exact.length) return exact;
  return db.prepare("SELECT id, name FROM artists WHERE norm LIKE ? ORDER BY length(norm) LIMIT 2").all(`${n}%`) as { id: string; name: string }[];
}

function titleFor(prompt: string) {
  let t = prompt
    .trim()
    .replace(/^(please\s+)?(make|create|build|generate|give|get|find)\s+(me\s+)?(a\s+|an\s+|some\s+)?/i, '')
    .replace(/^(playlist|mix|songs|music|tracks)\s+(for|of|to|with)\s+/i, '')
    .replace(/\s+(playlist|mix)$/i, '')
    .replace(/^(a|an)\s+/i, '')
    .replace(/[.!?]+$/, '');
  if (t.length > 48) t = t.slice(0, 46).replace(/\s+\S*$/, '') + '…';
  return t.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Your Mix';
}

export function generateFromPrompt(userId: string, prompt: string, explicitFilter = false): NLResult {
  const parsed = parsePrompt(prompt, lookupArtists);
  const idx = index();
  const p = profile(userId);
  const r = rng(prompt + Date.now());
  const seedFeats = parsed.artistIds.length ? idx.feats.filter((f) => f.artistId && parsed.artistIds.includes(f.artistId)) : [];
  const seedFams = new Set(seedFeats.flatMap((f) => f.fams));
  const seedEnergy = seedFeats.length ? seedFeats.reduce((a, f) => a + f.energy, 0) / seedFeats.length : null;
  const recentCut = [...idx.feats].sort((a, b) => b.addedAt - a.addedAt)[Math.min(idx.feats.length - 1, 200)]?.addedAt ?? 0;
  const hasTarget = !!(parsed.target.energy || parsed.target.prefer || parsed.target.bpm || parsed.target.instrumental);

  let pool = idx.feats.filter((f) => f.kind === 'music');
  if (explicitFilter || parsed.clean) pool = pool.filter((f) => !f.explicit);
  if (parsed.excludeFams.length) pool = pool.filter((f) => !f.fams.some((x) => parsed.excludeFams.includes(x)));
  if (parsed.years) {
    const inEra = pool.filter((f) => f.year && f.year >= parsed.years![0] && f.year <= parsed.years![1]);
    if (inEra.length >= 5) pool = inEra;
  }
  if (parsed.recent) pool = pool.filter((f) => f.addedAt >= recentCut);

  const scored = pool.map((f: Feat) => {
    let s = hasTarget ? targetScore(f, parsed.target) : 0.5;
    if (seedFeats.length) {
      const fam = f.fams.some((x) => seedFams.has(x)) ? 0.35 : 0;
      const art = f.artistId && parsed.artistIds.includes(f.artistId) ? 0.45 : 0;
      const en = seedEnergy != null ? (1 - Math.min(1, Math.abs(f.energy - seedEnergy) * 1.5)) * 0.2 : 0;
      s = s * (hasTarget ? 0.6 : 0.2) + fam + art + en;
    }
    s += affinity(p, f) * (hasTarget || seedFeats.length ? 0.25 : 0.6);
    s -= (p.skips.get(f.id) ?? 0) * 0.2;
    s += r() * 0.12;
    return { f, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const threshold = hasTarget ? 0.3 : -Infinity;
  const cands = scored.filter((x) => x.s > threshold).map((x) => x.f);
  let picked: Feat[];
  if (parsed.minutes) {
    const durations = new Map((db.prepare('SELECT id, duration FROM tracks').all() as { id: string; duration: number | null }[]).map((d) => [d.id, d.duration ?? 210]));
    const many = diversify(cands, 300, 3);
    picked = [];
    let total = 0;
    for (const f of many) {
      if (total >= parsed.minutes * 60) break;
      picked.push(f);
      total += durations.get(f.id) ?? 210;
    }
  } else picked = diversify(cands, parsed.count, parsed.artistIds.length ? 5 : 3);

  if (parsed.arc === 'rise') picked.sort((a, b) => a.energy - b.energy);
  else if (parsed.arc === 'fall') picked.sort((a, b) => b.energy - a.energy);
  if (parsed.arc) {
    // keep the arc but avoid back-to-back artists
    for (let i = 1; i < picked.length - 1; i++) if (picked[i].artistId && picked[i].artistId === picked[i - 1].artistId) [picked[i], picked[i + 1]] = [picked[i + 1], picked[i]];
  }
  const chips = [...parsed.chips];
  if (p.strength > 2) chips.push({ kind: 'taste', label: 'tuned to your taste' });
  const tracks = tracksByIds(userId, picked.map((f) => f.id));
  const description = chips.length
    ? `Built from “${prompt.trim()}” — ${chips.filter((c) => c.kind !== 'taste').map((c) => c.label).join(', ') || 'your taste'}.`
    : `Built from “${prompt.trim()}”.`;
  return { title: titleFor(prompt), description, chips, tracks };
}
