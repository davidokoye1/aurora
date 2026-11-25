/** Genre families, mood targets and natural-language vocabulary for the built-in recommendation engine. */

export interface GenreFamily {
  id: string;
  label: string;
  match: RegExp;
  energy: number;
  bpm: number;
  bright: number;
  instrumental?: boolean;
  color: string;
}

export const FAMILIES: GenreFamily[] = [
  { id: 'dnb', label: 'Drum & Bass', match: /drum ?(and|&|n) ?bass|dnb|d&b|jungle|liquid funk|neurofunk/i, energy: 0.85, bpm: 172, bright: 0.6, color: '#ff6b3d' },
  { id: 'dubstep', label: 'Bass', match: /dubstep|riddim|bass music|brostep|future bass|trap edm|wobble/i, energy: 0.85, bpm: 140, bright: 0.6, color: '#7b5cff' },
  { id: 'techno', label: 'Techno', match: /techno|industrial techno|minimal|hard ?style|hardcore|gabber|rave/i, energy: 0.82, bpm: 132, bright: 0.5, instrumental: true, color: '#3dd6ff' },
  { id: 'house', label: 'House', match: /house|deep house|tech house|garage|uk garage|disco|nu disco|edm|dance|electro ?house|club/i, energy: 0.75, bpm: 124, bright: 0.6, color: '#ff4fa3' },
  { id: 'trance', label: 'Trance', match: /trance|psytrance|goa|progressive/i, energy: 0.78, bpm: 138, bright: 0.65, instrumental: true, color: '#56a6ff' },
  { id: 'synthwave', label: 'Synthwave', match: /synthwave|retrowave|outrun|darksynth|vaporwave|chillwave|new retro|synth ?pop|darkwave|coldwave/i, energy: 0.55, bpm: 105, bright: 0.5, color: '#c25cff' },
  { id: 'ambient', label: 'Ambient', match: /ambient|drone|new age|meditation|soundscape|dark ambient|space music|field recording/i, energy: 0.15, bpm: 70, bright: 0.3, instrumental: true, color: '#5fc9b4' },
  { id: 'lofi', label: 'Lo-fi & Chillhop', match: /lo-?fi|chillhop|chill ?out|downtempo|trip ?hop|chill|beats/i, energy: 0.32, bpm: 85, bright: 0.35, instrumental: true, color: '#d8a46c' },
  { id: 'electronic', label: 'Electronic', match: /electro|electronic|electronica|idm|glitch|breakbeat|breaks|big beat|synth|experimental electronic|footwork|juke|edm/i, energy: 0.65, bpm: 120, bright: 0.55, color: '#4cc3ff' },
  { id: 'hiphop', label: 'Hip-Hop', match: /hip ?-?hop|rap|trap|boom ?bap|grime|drill|crunk|gangsta|g-funk|phonk/i, energy: 0.62, bpm: 92, bright: 0.5, color: '#ffb23d' },
  { id: 'rnb', label: 'R&B & Soul', match: /r ?(&|n|and) ?b|rnb|soul|neo-?soul|motown|funk|quiet storm|new jack/i, energy: 0.5, bpm: 95, bright: 0.45, color: '#ff7a6b' },
  { id: 'pop', label: 'Pop', match: /pop|k-?pop|j-?pop|c-?pop|dance ?pop|electropop|teen|top 40|europop|bubblegum/i, energy: 0.65, bpm: 118, bright: 0.65, color: '#ff5cc8' },
  { id: 'indie', label: 'Indie & Alternative', match: /indie|alternative|alt|shoegaze|dream ?pop|post-?punk|new wave|garage rock|lo-?fi indie|britpop|emo|math rock/i, energy: 0.58, bpm: 118, bright: 0.55, color: '#9bd45c' },
  { id: 'rock', label: 'Rock', match: /rock|grunge|classic rock|hard rock|psychedelic|prog|stoner|blues rock|southern rock|surf/i, energy: 0.72, bpm: 124, bright: 0.58, color: '#ff5f4a' },
  { id: 'metal', label: 'Metal', match: /metal|metalcore|deathcore|djent|thrash|doom|black metal|death metal|sludge|nu metal|grindcore/i, energy: 0.92, bpm: 140, bright: 0.65, color: '#b0b0b0' },
  { id: 'punk', label: 'Punk', match: /punk|hardcore punk|pop punk|ska|oi|skate/i, energy: 0.88, bpm: 160, bright: 0.65, color: '#ff3d6e' },
  { id: 'postrock', label: 'Post-Rock', match: /post-?rock|post-?metal|cinematic|instrumental rock/i, energy: 0.5, bpm: 110, bright: 0.45, instrumental: true, color: '#7cc6d8' },
  { id: 'jazz', label: 'Jazz', match: /jazz|bebop|swing|big band|bossa|fusion|smooth|acid jazz|nu jazz|lounge/i, energy: 0.4, bpm: 110, bright: 0.45, color: '#e0b25c' },
  { id: 'blues', label: 'Blues', match: /blues|delta|rhythm and blues/i, energy: 0.45, bpm: 95, bright: 0.45, color: '#5c8de0' },
  { id: 'classical', label: 'Classical', match: /classical|baroque|orchestra|symphon|opera|chamber|piano|romantic era|contemporary classical|choral|string quartet|neoclassical|modern classical|score/i, energy: 0.25, bpm: 90, bright: 0.4, instrumental: true, color: '#cfc3a3' },
  { id: 'soundtrack', label: 'Soundtrack', match: /soundtrack|ost|film|score|video game|game music|chiptune|8-?bit|anime/i, energy: 0.5, bpm: 110, bright: 0.5, instrumental: true, color: '#7ea0ff' },
  { id: 'folk', label: 'Folk & Acoustic', match: /folk|acoustic|singer-?songwriter|americana|bluegrass|celtic|indie folk|unplugged/i, energy: 0.35, bpm: 100, bright: 0.45, color: '#b9c46a' },
  { id: 'country', label: 'Country', match: /country|honky|western|outlaw/i, energy: 0.55, bpm: 110, bright: 0.55, color: '#e3a35a' },
  { id: 'reggae', label: 'Reggae & Dub', match: /reggae|dub|dancehall|ska|rocksteady|roots/i, energy: 0.5, bpm: 85, bright: 0.5, color: '#4fbf6a' },
  { id: 'latin', label: 'Latin', match: /latin|reggaeton|salsa|bachata|cumbia|merengue|samba|tango|flamenco|latino|urbano|dembow|mpb/i, energy: 0.7, bpm: 100, bright: 0.6, color: '#ffcf3d' },
  { id: 'afro', label: 'Afro', match: /afro|amapiano|highlife|afrobeat|afrobeats|gqom|kwaito|soukous/i, energy: 0.7, bpm: 112, bright: 0.6, color: '#ff9f3d' },
  { id: 'world', label: 'World', match: /world|traditional|ethnic|bollywood|indian|arabic|turkish|balkan|klezmer|gamelan|african|asian/i, energy: 0.5, bpm: 105, bright: 0.5, color: '#3dbfa8' },
  { id: 'gospel', label: 'Gospel & Spiritual', match: /gospel|christian|worship|spiritual|religious|devotional/i, energy: 0.5, bpm: 95, bright: 0.55, color: '#f4d58d' },
  { id: 'spoken', label: 'Spoken Word', match: /spoken|audiobook|comedy|speech|talk|podcast|lecture|poetry|radio/i, energy: 0.2, bpm: 0, bright: 0.4, color: '#9aa0b4' },
];

export const OTHER: GenreFamily = { id: 'other', label: 'Other', match: /$^/, energy: 0.5, bpm: 110, bright: 0.5, color: '#8b7bff' };

const famCache = new Map<string, GenreFamily[]>();
export function familiesOf(genre: string | null | undefined): GenreFamily[] {
  if (!genre) return [];
  const key = genre.toLowerCase();
  const c = famCache.get(key);
  if (c) return c;
  const out = FAMILIES.filter((f) => f.match.test(key));
  // "electronic" is a catch-all; drop it if a more specific electronic family matched
  const specific = out.filter((f) => f.id !== 'electronic');
  const res = specific.some((f) => ['dnb', 'dubstep', 'techno', 'house', 'trance', 'synthwave', 'ambient', 'lofi'].includes(f.id)) ? specific : out;
  famCache.set(key, res);
  return res;
}
export const familyById = (id: string) => FAMILIES.find((f) => f.id === id) ?? OTHER;

export interface MoodDef {
  id: string;
  label: string;
  blurb: string;
  energy: [number, number];
  bpm?: [number, number];
  bright?: [number, number];
  prefer: string[];
  avoid: string[];
  gradient: [string, string];
}

export const MOODS: MoodDef[] = [
  { id: 'chill', label: 'Chill', blurb: 'Unhurried, warm and easy.', energy: [0.1, 0.45], bpm: [60, 105], prefer: ['lofi', 'ambient', 'jazz', 'rnb', 'folk', 'synthwave'], avoid: ['metal', 'punk', 'dnb', 'techno'], gradient: ['#3a7bd5', '#00d2ff'] },
  { id: 'focus', label: 'Focus', blurb: 'Steady, mostly instrumental flow.', energy: [0.15, 0.5], bpm: [70, 125], prefer: ['ambient', 'lofi', 'classical', 'postrock', 'electronic', 'soundtrack'], avoid: ['hiphop', 'punk', 'metal', 'pop', 'spoken'], gradient: ['#134e5e', '#71b280'] },
  { id: 'energy', label: 'Workout', blurb: 'High-tempo fuel for moving.', energy: [0.7, 1], bpm: [120, 180], prefer: ['dnb', 'house', 'techno', 'hiphop', 'rock', 'metal', 'pop', 'dubstep', 'punk'], avoid: ['ambient', 'classical', 'folk', 'spoken'], gradient: ['#f12711', '#f5af19'] },
  { id: 'party', label: 'Party', blurb: 'Dance-floor ready, front to back.', energy: [0.65, 1], bpm: [110, 135], prefer: ['house', 'pop', 'hiphop', 'latin', 'afro', 'techno', 'rnb'], avoid: ['ambient', 'classical', 'folk', 'metal', 'spoken'], gradient: ['#da22ff', '#9733ee'] },
  { id: 'latenight', label: 'Late Night', blurb: 'After-hours glow and neon.', energy: [0.25, 0.6], bpm: [80, 120], bright: [0, 0.5], prefer: ['synthwave', 'rnb', 'lofi', 'electronic', 'jazz', 'house', 'trip'], avoid: ['country', 'punk', 'metal', 'spoken'], gradient: ['#141e30', '#6a3093'] },
  { id: 'happy', label: 'Feel Good', blurb: 'Bright, sunny, upbeat.', energy: [0.55, 0.9], bright: [0.5, 1], prefer: ['pop', 'latin', 'afro', 'reggae', 'indie', 'house', 'rnb', 'country'], avoid: ['metal', 'ambient', 'spoken'], gradient: ['#f7971e', '#ffd200'] },
  { id: 'melancholy', label: 'Melancholy', blurb: 'For rainy windows and long thoughts.', energy: [0.1, 0.45], bright: [0, 0.5], prefer: ['indie', 'folk', 'classical', 'ambient', 'postrock', 'rnb', 'blues'], avoid: ['house', 'latin', 'party', 'punk'], gradient: ['#2c3e50', '#4ca1af'] },
  { id: 'romance', label: 'Romance', blurb: 'Slow, close and soulful.', energy: [0.2, 0.55], bpm: [60, 105], prefer: ['rnb', 'jazz', 'latin', 'pop', 'folk', 'blues'], avoid: ['metal', 'punk', 'techno', 'dnb'], gradient: ['#cb356b', '#bd3f32'] },
  { id: 'sleep', label: 'Sleep', blurb: 'Soft and slow for winding down.', energy: [0, 0.25], bpm: [0, 90], prefer: ['ambient', 'classical', 'lofi', 'folk'], avoid: ['metal', 'punk', 'dnb', 'techno', 'house', 'hiphop', 'rock'], gradient: ['#0f2027', '#2c5364'] },
  { id: 'intense', label: 'Intense', blurb: 'Loud, heavy and relentless.', energy: [0.8, 1], prefer: ['metal', 'punk', 'dnb', 'dubstep', 'techno', 'rock'], avoid: ['ambient', 'jazz', 'folk', 'classical', 'lofi'], gradient: ['#1f1c18', '#8e0e00'] },
];

export const moodById = (id: string) => MOODS.find((m) => m.id === id);

/** Phrase → target hints for natural-language playlist prompts. */
export interface Intent {
  re: RegExp;
  label: string;
  energy?: [number, number];
  bpm?: [number, number];
  bright?: [number, number];
  prefer?: string[];
  avoid?: string[];
  instrumental?: boolean;
  arc?: 'rise' | 'fall' | 'steady';
}

export const INTENTS: Intent[] = [
  { re: /\b(late[- ]?night|midnight|after ?hours|3 ?am|night ?time|nocturnal|neon)\b/i, label: 'late night', energy: [0.25, 0.6], bright: [0, 0.5], prefer: ['synthwave', 'rnb', 'lofi', 'electronic', 'jazz', 'house'] },
  { re: /\b(drive|driving|road ?trip|cruis(e|ing)|highway|commute)\b/i, label: 'driving', energy: [0.45, 0.8], bpm: [95, 130], prefer: ['synthwave', 'rock', 'indie', 'electronic', 'pop', 'hiphop', 'house'], arc: 'steady' },
  { re: /\b(work ?out|gym|lifting|run|running|jog|cardio|hiit|training|sprint|cycling|spin)\b/i, label: 'workout', energy: [0.75, 1], bpm: [120, 180], prefer: ['dnb', 'house', 'techno', 'hiphop', 'rock', 'metal', 'pop', 'dubstep'], arc: 'rise' },
  { re: /\b(study|studying|focus|concentrat\w*|deep work|coding|programming|reading|homework|writing)\b/i, label: 'focus', energy: [0.1, 0.5], prefer: ['ambient', 'lofi', 'classical', 'postrock', 'electronic', 'soundtrack'], avoid: ['spoken'], instrumental: true },
  { re: /\b(sleep|sleeping|bed ?time|insomnia|nap|lullab\w*|wind ?down)\b/i, label: 'sleep', energy: [0, 0.25], bpm: [0, 90], prefer: ['ambient', 'classical', 'lofi'], avoid: ['metal', 'punk', 'dnb', 'techno', 'hiphop'], arc: 'fall' },
  { re: /\b(party|dance|dancing|club|rave|pregame|pre-?game|banger)s?\b/i, label: 'party', energy: [0.65, 1], bpm: [110, 135], prefer: ['house', 'pop', 'hiphop', 'latin', 'afro', 'techno'], arc: 'rise' },
  { re: /\b(chill|relax\w*|calm|mellow|lazy|unwind|cozy|cosy|easy|laid[- ]?back|sunday)\b/i, label: 'chill', energy: [0.1, 0.45], prefer: ['lofi', 'jazz', 'rnb', 'folk', 'ambient', 'indie'] },
  { re: /\b(sad|heart ?break|heartbroken|melanchol\w*|cry\w*|lonely|blue|rain\w*|grief|moody|gloomy)\b/i, label: 'melancholy', energy: [0.1, 0.45], bright: [0, 0.5], prefer: ['indie', 'folk', 'classical', 'postrock', 'rnb', 'blues', 'ambient'] },
  { re: /\b(happy|upbeat|feel[- ]?good|sunny|summer|sunshine|cheerful|joy\w*|positive|good vibes|beach)\b/i, label: 'feel good', energy: [0.55, 0.9], bright: [0.5, 1], prefer: ['pop', 'latin', 'afro', 'reggae', 'indie', 'house', 'rnb'] },
  { re: /\b(romantic|romance|love|date night|sensual|intimate|slow dance)\b/i, label: 'romance', energy: [0.2, 0.55], prefer: ['rnb', 'jazz', 'latin', 'pop', 'folk'] },
  { re: /\b(angry|aggressive|rage|furious|heavy|intense|hard)\b/i, label: 'intense', energy: [0.8, 1], prefer: ['metal', 'punk', 'dnb', 'dubstep', 'rock', 'techno'] },
  { re: /\b(morning|wake ?up|coffee|breakfast|sunrise)\b/i, label: 'morning', energy: [0.35, 0.7], bright: [0.45, 1], prefer: ['indie', 'folk', 'pop', 'jazz', 'rnb'], arc: 'rise' },
  { re: /\b(dinner|cooking|kitchen|wine|brunch|cocktail)\b/i, label: 'dinner', energy: [0.25, 0.55], prefer: ['jazz', 'rnb', 'latin', 'folk', 'lofi'] },
  { re: /\b(rainy day|autumn|fall|winter|snow)\b/i, label: 'seasonal', energy: [0.15, 0.5], prefer: ['folk', 'indie', 'jazz', 'classical', 'lofi'] },
  { re: /\b(gaming|game|epic|cinematic|adventure|boss fight)\b/i, label: 'epic', energy: [0.55, 0.95], prefer: ['soundtrack', 'electronic', 'dubstep', 'metal', 'postrock', 'techno'] },
  { re: /\b(meditat\w*|yoga|mindful\w*|spa|breath\w*)\b/i, label: 'meditation', energy: [0, 0.25], prefer: ['ambient', 'classical', 'world'], instrumental: true },
  { re: /\b(fast|up-?tempo|high[- ]?energy|energetic|hype|pump(ed)? up)\b/i, label: 'high energy', energy: [0.7, 1], bpm: [120, 190] },
  { re: /\b(slow|down-?tempo|low[- ]?energy|soft|gentle|quiet)\b/i, label: 'low energy', energy: [0, 0.4], bpm: [0, 105] },
  { re: /\b(instrumental|no vocals|without vocals|wordless)\b/i, label: 'instrumental', instrumental: true },
];
