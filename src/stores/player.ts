'use client';

import { create } from 'zustand';
import type { Track } from '@/lib/types';
import { getEngine } from '@/lib/client/audio-engine';
import { api } from '@/lib/client/api';
import { toast } from './ui';
import { canPlay } from './downloads';

export interface QueueItem {
  key: string;
  track: Track;
  from: 'context' | 'queue' | 'autoplay';
}

export interface PlayContext {
  type: 'album' | 'playlist' | 'artist' | 'mix' | 'liked' | 'search' | 'radio' | 'library' | 'history' | 'genre' | 'mood' | 'downloads' | 'collection' | 'other';
  id?: string;
  title: string;
  href?: string;
}

type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  items: QueueItem[];
  index: number;
  original: QueueItem[] | null; // upcoming order before shuffle
  context: PlayContext | null;
  playing: boolean;
  waiting: boolean;
  time: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  speed: number;
  sleep: { until: number | null; endOfTrack: boolean } | null;
  fullOpen: boolean;
  panel: 'queue' | 'lyrics' | 'info' | null;
  autoplayEnabled: boolean;
  autoplayLoading: boolean;
  privateSession: boolean;
  /** played-time accounting for the current track */
  acc: { trackId: string | null; ms: number; last: number | null; startedAt: number };

  current: () => QueueItem | null;
  playTracks: (tracks: Track[], opts?: { startIndex?: number; context?: PlayContext | null; shuffle?: boolean }) => void;
  playTrack: (t: Track, context?: PlayContext | null) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: (opts?: { auto?: boolean; crossfade?: boolean }) => void;
  prev: () => void;
  seek: (t: number) => void;
  jumpTo: (key: string) => void;
  addToQueue: (tracks: Track[]) => void;
  playNext: (tracks: Track[]) => void;
  removeFromQueue: (keys: string[]) => void;
  moveInQueue: (fromKey: string, toKey: string) => void;
  clearQueue: () => void;
  setShuffle: (v?: boolean) => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setSpeed: (v: number) => void;
  setSleep: (minutes: number | 'end' | null) => void;
  setFull: (v: boolean) => void;
  setPanel: (p: PlayerState['panel']) => void;
  togglePanel: (p: NonNullable<PlayerState['panel']>) => void;
  setAutoplay: (v: boolean) => void;
  setPrivate: (v: boolean) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
}

let keySeq = 0;
const mkKey = () => `q${Date.now().toString(36)}${(keySeq++).toString(36)}`;
const toItems = (tracks: Track[], from: QueueItem['from']): QueueItem[] => tracks.filter(canPlay).map((track) => ({ key: mkKey(), track, from }));

function shuffleArr<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const PERSIST_KEY = 'aurora.player.v1';
const ctxString = (c: PlayContext | null) => (c?.id && ['album', 'playlist', 'artist', 'mix'].includes(c.type) ? `${c.type}:${c.id}` : null);

export const usePlayer = create<PlayerState>((set, get) => {
  /** Report the finished/skipped listen for the outgoing track. */
  const flush = (reason: 'skip' | 'ended' | 'switch') => {
    const s = get();
    const { acc } = s;
    if (!acc.trackId) return;
    let ms = acc.ms;
    if (acc.last != null) ms += Date.now() - acc.last;
    const cur = s.items.find((i) => i.track.id === acc.trackId)?.track;
    const dur = s.duration || cur?.duration || 0;
    const completed = reason === 'ended' || (dur > 0 && ms / 1000 >= dur * 0.8);
    const skipped = reason === 'skip' && !completed && ms < 30_000 && (!dur || ms / 1000 < dur * 0.5);
    set({ acc: { trackId: null, ms: 0, last: null, startedAt: Date.now() } });
    if (ms < 1000 && !skipped) return;
    void api('/api/events', { body: { trackId: acc.trackId, msPlayed: Math.round(ms), completed, skipped, context: ctxString(s.context) }, keepalive: true }).catch(() => {});
  };

  const startAcc = (trackId: string) => set({ acc: { trackId, ms: 0, last: get().playing ? Date.now() : null, startedAt: Date.now() } });

  const loadCurrent = (autoplay: boolean, startAt?: number) => {
    const cur = get().current();
    if (!cur) return;
    startAcc(cur.track.id);
    set({ time: startAt ?? 0, duration: cur.track.duration ?? 0, buffered: 0, waiting: autoplay });
    void getEngine()
      .load(cur.track, { autoplay, startAt })
      .catch((e) => toast.error(`Couldn’t play “${cur.track.title}”: ${(e as Error).message}`));
    persist();
    updateMediaSession();
  };

  const fetchAutoplay = async () => {
    const s = get();
    if (s.autoplayLoading) return;
    set({ autoplayLoading: true });
    try {
      const recent = s.items.slice(Math.max(0, s.index - 30), s.index + 1).map((i) => i.track.id);
      const all = new Set(s.items.map((i) => i.track.id));
      const tracks = await api<Track[]>('/api/recs/autoplay', { body: { recent: [...all].slice(-150).concat(recent), count: 15 } });
      const fresh = tracks.filter((t) => !all.has(t.id));
      if (fresh.length) set((st) => ({ items: [...st.items, ...toItems(fresh, 'autoplay')] }));
    } catch {
      /* offline or no recommendations */
    } finally {
      set({ autoplayLoading: false });
    }
  };

  const persistNow = () => {
    try {
      const s = get();
      const start = Math.max(0, s.index - 50);
      const items = s.items.slice(start, s.index + 300);
      localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ items, index: s.index - start, context: s.context, time: getEngine().time || s.time, volume: s.volume, muted: s.muted, shuffle: s.shuffle, repeat: s.repeat, speed: s.speed, autoplayEnabled: s.autoplayEnabled }),
      );
    } catch {}
  };
  let persistTimer: number | null = null;
  const persist = () => {
    if (typeof window === 'undefined') return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persistNow, 400);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      persistNow();
      flush('switch');
    });
  }

  const updateMediaSession = () => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const cur = get().current();
    if (!cur) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const t = cur.track;
    const art = t.cover ? new URL(t.cover, location.href).toString() : new URL('/icons/icon-512.png', location.href).toString();
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album ?? '',
      artwork: [
        { src: art, sizes: '512x512', type: art.endsWith('.png') ? 'image/png' : 'image/jpeg' },
      ],
    });
  };

  return {
    items: [],
    index: -1,
    original: null,
    context: null,
    playing: false,
    waiting: false,
    time: 0,
    duration: 0,
    buffered: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    speed: 1,
    sleep: null,
    fullOpen: false,
    panel: null,
    autoplayEnabled: true,
    autoplayLoading: false,
    privateSession: false,
    acc: { trackId: null, ms: 0, last: null, startedAt: Date.now() },

    current: () => {
      const s = get();
      return s.items[s.index] ?? null;
    },

    playTracks: (tracks, opts = {}) => {
      const playable = tracks.filter(canPlay);
      if (!playable.length) {
        toast.error('Nothing playable here — the source may be offline or the format unsupported.');
        return;
      }
      flush('switch');
      let startTrack = tracks[opts.startIndex ?? 0];
      if (!startTrack || !canPlay(startTrack)) startTrack = playable[0];
      let items = toItems(playable, 'context');
      let index = Math.max(0, items.findIndex((i) => i.track.id === startTrack.id));
      const shuffle = opts.shuffle ?? get().shuffle;
      let original: QueueItem[] | null = null;
      if (shuffle) {
        if (opts.startIndex == null) index = Math.floor(Math.random() * items.length);
        const head = items[index];
        const rest = items.filter((_, i) => i !== index);
        original = rest;
        items = [head, ...shuffleArr(rest)];
        index = 0;
      }
      // keep user-queued "next up" items after the new current track
      const queued = get().items.slice(get().index + 1).filter((i) => i.from === 'queue');
      if (queued.length) items.splice(index + 1, 0, ...queued);
      set({ items, index, context: opts.context ?? null, shuffle, original });
      loadCurrent(true);
    },

    playTrack: (t, context = null) => get().playTracks([t], { context }),

    toggle: () => {
      const s = get();
      if (!s.current()) return;
      const e = getEngine();
      if (!e.paused) e.pause();
      else {
        if (!s.acc.trackId) loadCurrent(true, s.time);
        else void e.play();
      }
    },
    play: () => {
      const s = get();
      if (!s.current()) return;
      if (!s.acc.trackId) loadCurrent(true, s.time);
      else void getEngine().play();
    },
    pause: () => getEngine().pause(),

    next: (opts = {}) => {
      const s = get();
      if (opts.auto && s.repeat === 'one' && !opts.crossfade) {
        flush('ended');
        startAcc(s.items[s.index].track.id);
        getEngine().seek(0);
        void getEngine().play();
        return;
      }
      if (s.sleep?.endOfTrack && opts.auto) {
        flush('ended');
        set({ sleep: null });
        getEngine().pause();
        toast.info('Sleep timer: playback paused at the end of the track.');
        return;
      }
      flush(opts.auto ? 'ended' : 'skip');
      let index = s.index + 1;
      if (index >= s.items.length) {
        if (s.repeat === 'all' && s.items.length) {
          index = Math.max(0, s.items.findIndex((i) => i.from === 'context'));
          // drop played user-queue items when looping
          const items = s.items.filter((i, k) => i.from === 'context' || k > s.index);
          set({ items, index: Math.max(0, items.findIndex((i) => i.from === 'context')) });
          loadCurrent(true);
          return;
        }
        if (s.autoplayEnabled) {
          void fetchAutoplay().then(() => {
            if (get().items.length > s.index + 1) {
              set({ index: s.index + 1 });
              loadCurrent(true);
            } else {
              getEngine().pause();
              set({ playing: false });
            }
          });
          return;
        }
        getEngine().pause();
        getEngine().seek(0);
        set({ playing: false });
        return;
      }
      set({ index });
      if (opts.crossfade) {
        const cur = get().current()!;
        getEngine().adoptCrossfaded(cur.track);
        startAcc(cur.track.id);
        set({ time: 0, duration: cur.track.duration ?? 0 });
        persist();
        updateMediaSession();
      } else loadCurrent(opts.auto ? true : !getEngine().paused || s.playing || true);
      // top up autoplay when we're running low
      if (get().autoplayEnabled && get().items.length - get().index <= 2) void fetchAutoplay();
    },

    prev: () => {
      const s = get();
      const e = getEngine();
      if (e.time > 3 || s.index <= 0) {
        e.seek(0);
        if (e.paused) void e.play();
        return;
      }
      flush('skip');
      set({ index: s.index - 1 });
      loadCurrent(true);
    },

    seek: (t) => {
      getEngine().seek(t);
      set({ time: t });
    },

    jumpTo: (key) => {
      const s = get();
      const i = s.items.findIndex((x) => x.key === key);
      if (i < 0) return;
      flush('skip');
      set({ index: i });
      loadCurrent(true);
    },

    addToQueue: (tracks) => {
      const add = toItems(tracks, 'queue');
      if (!add.length) return;
      set((s) => {
        if (s.index < 0) return { items: add, index: 0 };
        let at = s.index + 1;
        while (at < s.items.length && s.items[at].from === 'queue') at++;
        const items = [...s.items];
        items.splice(at, 0, ...add);
        return { items };
      });
      if (get().items.length === add.length && get().index === 0 && !get().acc.trackId) loadCurrent(false);
      toast.success(tracks.length === 1 ? `Added “${tracks[0].title}” to queue` : `Added ${add.length} songs to queue`);
      persist();
    },

    playNext: (tracks) => {
      const add = toItems(tracks, 'queue');
      if (!add.length) return;
      set((s) => {
        if (s.index < 0) return { items: add, index: 0 };
        const items = [...s.items];
        items.splice(s.index + 1, 0, ...add);
        return { items };
      });
      if (get().items.length === add.length && !get().acc.trackId) loadCurrent(false);
      toast.success(tracks.length === 1 ? `“${tracks[0].title}” will play next` : `${add.length} songs will play next`);
      persist();
    },

    removeFromQueue: (keys) => {
      set((s) => {
        const cur = s.items[s.index];
        const items = s.items.filter((i) => !keys.includes(i.key) || i === cur);
        return { items, index: items.indexOf(cur) };
      });
      persist();
    },

    moveInQueue: (fromKey, toKey) => {
      set((s) => {
        const items = [...s.items];
        const from = items.findIndex((i) => i.key === fromKey);
        const to = items.findIndex((i) => i.key === toKey);
        if (from <= s.index || to <= s.index || from < 0 || to < 0) return {};
        const [m] = items.splice(from, 1);
        // dragging into the "next up" region makes it a queued item
        const target = items[Math.min(to, items.length - 1)];
        items.splice(to, 0, { ...m, from: target?.from === 'queue' || to === s.index + 1 ? 'queue' : m.from === 'queue' ? 'context' : m.from });
        return { items };
      });
      persist();
    },

    clearQueue: () => {
      set((s) => ({ items: s.items.filter((i, k) => k <= s.index || i.from !== 'queue') }));
      persist();
    },

    setShuffle: (v) => {
      const s = get();
      const on = v ?? !s.shuffle;
      if (on === s.shuffle) return;
      const head = s.items.slice(0, s.index + 1);
      const upcoming = s.items.slice(s.index + 1);
      const queued = upcoming.filter((i) => i.from === 'queue');
      const rest = upcoming.filter((i) => i.from !== 'queue');
      if (on) {
        set({ shuffle: true, original: rest, items: [...head, ...queued, ...shuffleArr(rest)] });
      } else {
        const orig = s.original;
        let restored = rest;
        if (orig) {
          const present = new Set(rest.map((i) => i.key));
          restored = orig.filter((i) => present.has(i.key));
          for (const i of rest) if (!restored.includes(i)) restored.push(i);
        }
        set({ shuffle: false, original: null, items: [...head, ...queued, ...restored] });
      }
      persist();
    },

    cycleRepeat: () => {
      set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }));
      persist();
    },

    setVolume: (v) => {
      const volume = Math.max(0, Math.min(1, v));
      set({ volume, muted: volume === 0 ? get().muted : false });
      getEngine().setOptions({ volume, muted: volume === 0 ? get().muted : false });
      persist();
    },
    toggleMute: () => {
      const muted = !get().muted;
      set({ muted });
      getEngine().setOptions({ muted });
      persist();
    },
    setSpeed: (v) => {
      set({ speed: v });
      getEngine().setOptions({ speed: v });
      persist();
    },
    setSleep: (m) => {
      if (m === null) set({ sleep: null });
      else if (m === 'end') set({ sleep: { until: null, endOfTrack: true } });
      else set({ sleep: { until: Date.now() + m * 60_000, endOfTrack: false } });
    },
    setFull: (v) => set({ fullOpen: v }),
    setPanel: (p) => set({ panel: p }),
    togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
    setAutoplay: (v) => {
      set({ autoplayEnabled: v });
      if (!v) set((s) => ({ items: s.items.filter((i, k) => k <= s.index || i.from !== 'autoplay') }));
      persist();
    },
    setPrivate: (v) => set({ privateSession: v }),
    updateTrack: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.track.id === id ? { ...i, track: { ...i.track, ...patch } } : i)) })),
  };
});

/** Wire the engine to the store once on the client. */
let wired = false;
export function wirePlayer() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  const e = getEngine();
  const st = usePlayer;
  // restore
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      st.setState({
        items: p.items ?? [], index: p.index ?? -1, context: p.context ?? null, time: p.time ?? 0, volume: p.volume ?? 0.8, muted: !!p.muted,
        shuffle: !!p.shuffle, repeat: p.repeat ?? 'off', speed: p.speed ?? 1, autoplayEnabled: p.autoplayEnabled ?? true,
        duration: p.items?.[p.index]?.track?.duration ?? 0,
      });
      e.setOptions({ volume: p.volume ?? 0.8, muted: !!p.muted, speed: p.speed ?? 1 });
    }
  } catch {}

  e.setNextProvider(
    () => {
      const s = st.getState();
      if (s.repeat === 'one') return null;
      if (s.sleep?.endOfTrack) return null;
      return s.items[s.index + 1]?.track ?? (s.repeat === 'all' ? s.items.find((i) => i.from === 'context')?.track ?? null : null);
    },
    () => st.getState().next({ auto: true, crossfade: true }),
  );

  let lastPatch = '';
  e.on((ev) => {
    const s = st.getState();
    switch (ev.type) {
      case 'time':
        st.setState({ time: ev.time, duration: ev.duration || s.duration, buffered: ev.buffered });
        if ('mediaSession' in navigator && ev.duration && Number.isFinite(ev.duration)) {
          try {
            navigator.mediaSession.setPositionState({ duration: ev.duration, position: Math.min(ev.time, ev.duration), playbackRate: s.speed });
          } catch {}
        }
        break;
      case 'play':
        st.setState({ playing: true, acc: { ...s.acc, last: s.acc.last ?? Date.now() } });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        break;
      case 'pause': {
        const acc = s.acc;
        st.setState({ playing: false, acc: { ...acc, ms: acc.ms + (acc.last ? Date.now() - acc.last : 0), last: null } });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        break;
      }
      case 'waiting':
        st.setState({ waiting: ev.waiting });
        break;
      case 'ended':
        s.next({ auto: true });
        break;
      case 'loaded': {
        const cur = s.current();
        if (cur && cur.track.id === ev.trackId && (!cur.track.duration || Math.abs(cur.track.duration - ev.duration) > 3) && lastPatch !== ev.trackId) {
          lastPatch = ev.trackId;
          s.updateTrack(ev.trackId, { duration: ev.duration });
          void api(`/api/tracks/${ev.trackId}`, { method: 'PATCH', body: { duration: ev.duration } }).catch(() => {});
        }
        break;
      }
      case 'error': {
        const cur = s.current();
        st.setState({ waiting: false });
        toast.error(`Couldn’t play “${cur?.track.title ?? 'track'}”. ${ev.message} Skipping…`);
        s.updateTrack(ev.trackId, { playable: navigator.onLine ? false : cur?.track.playable ?? true });
        if (s.index < s.items.length - 1) window.setTimeout(() => st.getState().next(), 900);
        else st.setState({ playing: false });
        break;
      }
    }
  });

  // sleep timer
  window.setInterval(() => {
    const s = st.getState();
    if (s.sleep?.until && Date.now() >= s.sleep.until - 8000 && s.playing) {
      st.setState({ sleep: null });
      e.fadeOutAndPause(8, () => toast.info('Sleep timer: goodnight. Playback paused.'));
    }
  }, 1000);

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const h = (a: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {}
    };
    h('play', () => st.getState().play());
    h('pause', () => st.getState().pause());
    h('previoustrack', () => st.getState().prev());
    h('nexttrack', () => st.getState().next());
    h('seekto', (d) => d.seekTime != null && st.getState().seek(d.seekTime));
    h('seekbackward', (d) => st.getState().seek(Math.max(0, e.time - (d.seekOffset ?? 10))));
    h('seekforward', (d) => st.getState().seek(e.time + (d.seekOffset ?? 10)));
    h('stop', () => st.getState().pause());
  }
}
