'use client';

import type { Track } from '../types';
import { offlineUrl } from './offline';

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS: Record<string, { label: string; bands: number[] }> = {
  flat: { label: 'Flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Bass Boost', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  warm: { label: 'Warm', bands: [3, 3, 2, 1, 0, -1, -1, -2, -2, -3] },
  bright: { label: 'Bright', bands: [-2, -1, 0, 0, 0, 1, 2, 3, 4, 4] },
  vocal: { label: 'Vocal', bands: [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1] },
  rock: { label: 'Rock', bands: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4] },
  electronic: { label: 'Electronic', bands: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  acoustic: { label: 'Acoustic', bands: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1] },
  jazz: { label: 'Jazz', bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  classical: { label: 'Classical', bands: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  loudness: { label: 'Loudness', bands: [5, 3, 0, 0, -1, 0, -1, -3, 3, 1] },
  late: { label: 'Late Night', bands: [2, 2, 1, 0, 0, -1, -2, -3, -4, -5] },
  podcast: { label: 'Spoken Word', bands: [-4, -3, -1, 1, 3, 4, 3, 1, -1, -3] },
};

type Listener = (e: EngineEvent) => void;
export type EngineEvent =
  | { type: 'time'; time: number; duration: number; buffered: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'waiting'; waiting: boolean }
  | { type: 'error'; message: string; trackId: string }
  | { type: 'loaded'; duration: number; trackId: string }
  | { type: 'crossfade-start' };

interface Deck {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
  trackId: string | null;
}

export interface EngineOptions {
  crossfade: number;
  gapless: boolean;
  normalize: boolean;
  eqEnabled: boolean;
  eqBands: number[];
  volume: number;
  muted: boolean;
  speed: number;
  quality: 'best' | 'smallest';
}

/**
 * Two-deck HTML5 audio engine routed through Web Audio for EQ, loudness normalisation and crossfades.
 * All audio is same-origin (/api/stream or offline blobs), so the Web Audio graph is never tainted.
 */
class AudioEngine {
  private decks: [Deck, Deck];
  private active = 0;
  private ctx: AudioContext | null = null;
  private eq: BiquadFilterNode[] = [];
  private norm: GainNode | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  analyser: AnalyserNode | null = null;
  private listeners = new Set<Listener>();
  private opts: EngineOptions = { crossfade: 0, gapless: true, normalize: true, eqEnabled: false, eqBands: EQ_PRESETS.flat.bands, volume: 0.8, muted: false, speed: 1, quality: 'best' };
  private current: Track | null = null;
  private preloaded: Track | null = null;
  private fading = false;
  private fadeTimer: number | null = null;
  private nextProvider: (() => Track | null) | null = null;
  private crossfadeHandler: (() => void) | null = null;
  private sleepFade: number | null = null;

  constructor() {
    const mk = (): Deck => {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      return { el, src: null, gain: null, trackId: null };
    };
    this.decks = [mk(), mk()];
    this.decks.forEach((d, i) => this.bind(d, i));
    if (typeof window !== 'undefined') window.setInterval(() => this.watchCrossfade(), 250);
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e);
  }

  private get deck() {
    return this.decks[this.active];
  }
  private get other() {
    return this.decks[1 - this.active];
  }

  private bind(d: Deck, i: number) {
    const isActive = () => this.active === i;
    d.el.addEventListener('timeupdate', () => isActive() && this.emitTime());
    d.el.addEventListener('durationchange', () => isActive() && this.emitTime());
    d.el.addEventListener('progress', () => isActive() && this.emitTime());
    d.el.addEventListener('play', () => isActive() && this.emit({ type: 'play' }));
    d.el.addEventListener('pause', () => isActive() && !this.fading && this.emit({ type: 'pause' }));
    d.el.addEventListener('waiting', () => isActive() && this.emit({ type: 'waiting', waiting: true }));
    d.el.addEventListener('playing', () => isActive() && this.emit({ type: 'waiting', waiting: false }));
    d.el.addEventListener('canplay', () => isActive() && this.emit({ type: 'waiting', waiting: false }));
    d.el.addEventListener('loadedmetadata', () => {
      if (isActive() && d.trackId && Number.isFinite(d.el.duration)) this.emit({ type: 'loaded', duration: d.el.duration, trackId: d.trackId });
    });
    d.el.addEventListener('ended', () => {
      if (isActive()) this.emit({ type: 'ended' });
    });
    d.el.addEventListener('error', () => {
      if (!isActive() || !d.trackId || !d.el.src) return;
      const code = d.el.error?.code;
      const msg = code === 4 ? 'This format can’t be played in your browser.' : code === 2 ? 'Network error while streaming.' : 'Playback failed.';
      this.emit({ type: 'error', message: msg, trackId: d.trackId });
    });
  }

  private emitTime() {
    const el = this.deck.el;
    let buffered = 0;
    try {
      for (let i = 0; i < el.buffered.length; i++) if (el.buffered.start(i) <= el.currentTime) buffered = el.buffered.end(i);
    } catch {}
    this.emit({ type: 'time', time: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : this.current?.duration ?? 0, buffered });
  }

  /** Lazily build the Web Audio graph (must happen after a user gesture). */
  private ensureGraph() {
    if (this.ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC({ latencyHint: 'playback' });
      this.ctx = ctx;
      this.eq = EQ_FREQS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.1;
        b.gain.value = 0;
        return b;
      });
      this.norm = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;
      this.master = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      for (const d of this.decks) {
        d.src = ctx.createMediaElementSource(d.el);
        d.gain = ctx.createGain();
        d.src.connect(d.gain);
        d.gain.connect(this.eq[0]);
      }
      for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);
      this.eq[this.eq.length - 1].connect(this.norm);
      this.norm.connect(this.limiter);
      this.limiter.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.decks.forEach((d) => (d.el.volume = 1));
      this.applyAll();
    } catch (e) {
      console.warn('Web Audio unavailable, using basic playback', e);
      this.ctx = null;
    }
  }

  setOptions(o: Partial<EngineOptions>) {
    this.opts = { ...this.opts, ...o };
    this.applyAll();
  }
  getOptions() {
    return this.opts;
  }

  private applyAll() {
    const vol = this.opts.muted ? 0 : this.opts.volume;
    const curved = vol * vol; // perceptual curve
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(curved, this.ctx.currentTime, 0.02);
      this.eq.forEach((b, i) => b.gain.setTargetAtTime(this.opts.eqEnabled ? this.opts.eqBands[i] ?? 0 : 0, this.ctx!.currentTime, 0.03));
      this.applyNormalization();
    } else {
      for (const d of this.decks) d.el.volume = curved;
    }
    for (const d of this.decks) d.el.playbackRate = this.opts.speed;
  }

  private applyNormalization() {
    if (!this.ctx || !this.norm) return;
    let db = 0;
    const t = this.current;
    if (this.opts.normalize && t) {
      if (t.replaygain != null) db = t.replaygain;
      else if (t.loudness != null) db = -17 - t.loudness;
      db = Math.max(-10, Math.min(6, db));
    }
    // compensate EQ boosts so they don't clip
    const eqMax = this.opts.eqEnabled ? Math.max(0, ...this.opts.eqBands) : 0;
    db -= eqMax * 0.5;
    this.norm.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.1);
  }

  private async srcFor(t: Track): Promise<string> {
    const off = await offlineUrl(t.id);
    if (off) return off;
    return `/api/stream/${encodeURIComponent(t.id)}${this.opts.quality === 'smallest' ? '?q=smallest' : ''}`;
  }

  setNextProvider(fn: () => Track | null, onCrossfade: () => void) {
    this.nextProvider = fn;
    this.crossfadeHandler = onCrossfade;
  }

  /** Load and (optionally) start a track on the active deck. */
  async load(t: Track, opts: { autoplay: boolean; startAt?: number }) {
    this.ensureGraph();
    this.cancelFade();
    const d = this.deck;
    this.current = t;
    // If the other deck preloaded this exact track, swap to it for a near-gapless start.
    if (this.preloaded?.id === t.id && this.other.trackId === t.id && this.other.el.readyState >= 2) {
      d.el.pause();
      this.active = 1 - this.active;
      this.setDeckGain(this.deck, 1);
      this.setDeckGain(this.other, 0);
    } else {
      d.trackId = t.id;
      d.el.src = await this.srcFor(t);
      if (this.current?.id !== t.id) return;
      d.el.playbackRate = this.opts.speed;
      this.setDeckGain(d, 1);
      if (opts.startAt) {
        const s = opts.startAt;
        const once = () => {
          d.el.currentTime = s;
          d.el.removeEventListener('loadedmetadata', once);
        };
        d.el.addEventListener('loadedmetadata', once);
      }
    }
    this.preloaded = null;
    this.other.el.pause();
    this.applyNormalization();
    this.emitTime();
    if (opts.autoplay) await this.play();
  }

  private setDeckGain(d: Deck, v: number, ramp = 0) {
    if (d.gain && this.ctx) {
      d.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      if (ramp) {
        d.gain.gain.setValueAtTime(d.gain.gain.value, this.ctx.currentTime);
        d.gain.gain.linearRampToValueAtTime(v, this.ctx.currentTime + ramp);
      } else d.gain.gain.setValueAtTime(v, this.ctx.currentTime);
    } else if (!this.ctx) {
      d.el.volume = v * (this.opts.muted ? 0 : this.opts.volume ** 2);
    }
  }

  async play() {
    this.ensureGraph();
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {});
    try {
      await this.deck.el.play();
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError') this.emit({ type: 'pause' });
      else if ((e as Error).name !== 'AbortError') throw e;
    }
  }
  pause() {
    this.deck.el.pause();
    if (this.fading) {
      this.other.el.pause();
    }
  }
  toggle() {
    if (this.deck.el.paused) return this.play();
    this.pause();
  }
  seek(t: number) {
    const el = this.deck.el;
    if (!Number.isFinite(t)) return;
    el.currentTime = Math.max(0, Math.min(t, Number.isFinite(el.duration) ? el.duration - 0.25 : t));
    this.emitTime();
  }
  get time() {
    return this.deck.el.currentTime;
  }
  get duration() {
    const d = this.deck.el.duration;
    return Number.isFinite(d) ? d : this.current?.duration ?? 0;
  }
  get paused() {
    return this.deck.el.paused;
  }
  stop() {
    for (const d of this.decks) {
      d.el.pause();
      d.el.removeAttribute('src');
      d.el.load();
      d.trackId = null;
    }
    this.current = null;
  }

  /** Called by the watcher: preload the next track near the end, and start a crossfade when configured. */
  private async watchCrossfade() {
    const d = this.deck;
    if (!this.current || d.el.paused || !this.nextProvider) return;
    const dur = d.el.duration;
    if (!Number.isFinite(dur) || dur < 20) return;
    const remaining = dur - d.el.currentTime;
    const next = this.nextProvider();
    if (!next) return;
    if (remaining < 25 && this.preloaded?.id !== next.id && (this.opts.gapless || this.opts.crossfade > 0)) {
      this.preloaded = next;
      const o = this.other;
      o.trackId = next.id;
      o.el.src = await this.srcFor(next);
      o.el.preload = 'auto';
      o.el.playbackRate = this.opts.speed;
      this.setDeckGain(o, 0);
      o.el.load();
    }
    const cf = this.opts.crossfade;
    if (cf > 0 && !this.fading && remaining <= cf && this.preloaded?.id === next.id && this.other.el.readyState >= 2) {
      this.startCrossfade(cf);
    }
  }

  private startCrossfade(secs: number) {
    if (!this.ctx) return;
    this.fading = true;
    const out = this.deck;
    const inn = this.other;
    inn.el.currentTime = 0;
    this.setDeckGain(inn, 0);
    void inn.el.play().catch(() => {});
    this.setDeckGain(inn, 1, secs);
    this.setDeckGain(out, 0, secs);
    this.active = 1 - this.active;
    this.current = this.preloaded;
    this.preloaded = null;
    this.applyNormalization();
    this.emit({ type: 'crossfade-start' });
    this.crossfadeHandler?.();
    this.fadeTimer = window.setTimeout(() => {
      out.el.pause();
      this.fading = false;
    }, secs * 1000 + 100);
  }

  /** Swap decks after the queue advanced due to a crossfade (the new deck is already playing). */
  adoptCrossfaded(t: Track) {
    this.current = t;
  }
  get crossfading() {
    return this.fading;
  }

  private cancelFade() {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.fading) {
      this.other.el.pause();
      this.fading = false;
    }
  }

  /** Gradually lower volume then pause (sleep timer). */
  fadeOutAndPause(secs = 8, done?: () => void) {
    if (this.sleepFade) return;
    const start = this.opts.volume;
    const steps = secs * 10;
    let i = 0;
    this.sleepFade = window.setInterval(() => {
      i++;
      const v = start * (1 - i / steps);
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(Math.max(0, v * v), this.ctx.currentTime, 0.05);
      else this.deck.el.volume = Math.max(0, v * v);
      if (i >= steps) {
        clearInterval(this.sleepFade!);
        this.sleepFade = null;
        this.pause();
        this.applyAll();
        done?.();
      }
    }, 100);
  }

  get hasGraph() {
    return !!this.ctx;
  }
}

let engine: AudioEngine | null = null;
export function getEngine(): AudioEngine {
  if (typeof window === 'undefined') throw new Error('Audio engine is client-only');
  return (engine ??= new AudioEngine());
}
export type { AudioEngine };
