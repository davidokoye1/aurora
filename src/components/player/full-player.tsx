'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Heart, MoreHorizontal, MicVocal, ListMusic, SlidersHorizontal, Moon, Gauge, Check, Info } from 'lucide-react';
import { usePlayer } from '@/stores/player';
import { getEngine } from '@/lib/client/audio-engine';
import { useLike, useMediaQuery, useSettings } from '@/lib/client/hooks';
import { Artwork } from '@/components/ui/artwork';
import { IconButton } from '@/components/ui/button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/components/ui/cn';
import { useTrackMenu } from '@/components/media/track-menu';
import { useArtColor } from '@/components/media/cards';
import { SeekBar, TransportControls, VolumeControl, SpeedMenu, SleepMenu } from './controls';
import { LyricsView, QueueView } from './panels';
import { EqualizerPanel } from './equalizer';

type Side = 'lyrics' | 'queue' | 'eq';
const SIDE_LABEL: Record<Side, string> = { lyrics: 'Lyrics', queue: 'Up next', eq: 'Equalizer' };

export function FullPlayer() {
  const open = usePlayer((s) => s.fullOpen);
  const cur = usePlayer((s) => s.items[s.index]?.track);
  const ctx = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const sleep = usePlayer((s) => s.sleep);
  const speed = usePlayer((s) => s.speed);
  const like = useLike();
  const menu = useTrackMenu();
  const { settings } = useSettings();
  const phone = useMediaQuery('(max-width: 767px)');
  const artColor = useArtColor(cur?.cover);
  const [side, setSide] = useState<Side | null>(null);
  const [desktopSide, setDesktopSide] = useState<Side | null>('lyrics');
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);

  useEffect(() => {
    if (!open) return;
    // Escape closes the player — unless a sheet (lyrics / queue / actions) is open on top of it
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !side && !document.querySelector('[data-vaul-drawer]') && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const close = () => {
    setClosing(true);
    setSide(null);
    setTimeout(() => {
      usePlayer.getState().setFull(false);
      setClosing(false);
      setDy(0);
    }, 220);
  };

  if (!open || !cur) return null;
  // Artwork colour, kept in a readable mid band (never neon, never near-black)
  const c = settings.adaptiveAccent && artColor ? clampTone(artColor) : '#2e2a27';

  const extras: MenuItem[] = [
    ...menu([cur]),
    { separator: true, label: '' },
    {
      label: sleep ? (sleep.endOfTrack ? 'Sleep timer: end of track' : `Sleep timer: on`) : 'Sleep timer',
      icon: <Moon />,
      children: [
        ...([5, 15, 30, 45, 60, 90] as const).map((m) => ({ label: m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : '1.5 hours', onSelect: () => usePlayer.getState().setSleep(m) })),
        { label: 'End of track', onSelect: () => usePlayer.getState().setSleep('end') },
        ...(sleep ? [{ label: 'Turn off', icon: <Check />, onSelect: () => usePlayer.getState().setSleep(null) }] : []),
      ],
    },
    {
      label: `Playback speed: ${speed === 1 ? 'normal' : `${speed}×`}`,
      icon: <Gauge />,
      children: [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((v) => ({ label: v === 1 ? 'Normal' : `${v}×`, checked: v === speed, onSelect: () => usePlayer.getState().setSpeed(v) })),
    },
    { label: 'Equalizer', icon: <SlidersHorizontal />, onSelect: () => setSide('eq') },
  ];
  const sheetHeader = { art: <Artwork src={cur.cover} alt="" className="size-12" rounded="sm" seed={cur.album ?? cur.title} />, title: cur.title, subtitle: cur.artist };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      className={cn('fixed inset-0 z-[70] flex flex-col overflow-hidden text-[#f5efe6] transition-transform duration-200', closing ? 'translate-y-full' : 'animate-[slide-up_260ms_cubic-bezier(0.2,0.8,0.2,1)]')}
      style={{
        ...(dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : {}),
        background: `color-mix(in srgb, ${c} 42%, #0c0b0a)`,
        ['--text' as string]: '#f5efe6',
        ['--text-2' as string]: 'rgba(245,239,230,0.68)',
        ['--surface-3' as string]: 'rgba(245,239,230,0.2)',
        ['--surface-hover' as string]: 'rgba(245,239,230,0.08)',
      }}
      onTouchStart={(e) => {
        if ((e.target as HTMLElement).closest('[data-noswipe]')) return;
        drag.current = { y: e.touches[0].clientY, dy: 0 };
      }}
      onTouchMove={(e) => {
        if (!drag.current) return;
        const d = e.touches[0].clientY - drag.current.y;
        drag.current.dy = d;
        if (d > 0) setDy(d);
      }}
      onTouchEnd={() => {
        const d = drag.current?.dy ?? 0;
        drag.current = null;
        if (d > 110) close();
        else setDy(0);
      }}
    >
      <Backdrop cover={cur.cover} playing={playing} reduce={settings.reduceMotion} />

      <header className="safe-top relative z-10 shrink-0">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/30 md:hidden" aria-hidden />
        <div className="flex h-14 items-center justify-between px-2 md:h-16 md:px-6">
          <button onClick={close} aria-label="Close player" className="press flex size-11 items-center justify-center rounded-full hover:bg-white/10">
            <ChevronDown className="size-7" />
          </button>
          <div className="min-w-0 px-2 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">Playing from</div>
            <div className="truncate text-[14px] font-semibold">
              {ctx?.href ? (
                <Link href={ctx.href} onClick={close} className="hover:underline">
                  {ctx.title}
                </Link>
              ) : (
                ctx?.title ?? 'Your queue'
              )}
            </div>
          </div>
          <Menu
            items={() => extras}
            header={sheetHeader}
            trigger={
              <button aria-label="More options" className="press flex size-11 items-center justify-center rounded-full hover:bg-white/10">
                <MoreHorizontal className="size-6" />
              </button>
            }
          />
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row md:gap-12 md:px-12 md:pb-10 lg:px-20">
        <div className="flex min-h-0 flex-1 flex-col justify-between px-6 pb-[max(env(safe-area-inset-bottom),16px)] md:items-center md:justify-center md:gap-8 md:px-0 md:pb-0">
          {/* Artwork: swipe left/right to change track */}
          <div className="flex flex-1 items-center justify-center py-4 md:flex-none md:py-0">
            <div
              data-noswipe
              className={cn('relative aspect-square w-full max-w-[min(100%,46dvh)] transition-transform duration-300 md:max-w-[min(42vw,56vh)]', playing ? 'scale-100' : 'scale-[0.92]')}
              style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: 'none' } : undefined}
              onTouchStart={(e) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
              onTouchMove={(e) => {
                if (!swipe.current) return;
                const d = e.touches[0].clientX - swipe.current.x;
                if (Math.abs(d) > Math.abs(e.touches[0].clientY - swipe.current.y)) setDx(d);
              }}
              onTouchEnd={() => {
                const d = dx;
                swipe.current = null;
                setDx(0);
                if (Math.abs(d) > 70) {
                  navigator.vibrate?.(8);
                  if (d < 0) usePlayer.getState().next();
                  else usePlayer.getState().prev();
                }
              }}
            >
              <Artwork src={cur.cover} alt={cur.album ?? cur.title} className="size-full shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]" rounded="lg" seed={cur.album ?? cur.title} priority />
            </div>
          </div>

          <div className="w-full shrink-0 md:max-w-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-display text-[24px] font-extrabold leading-tight md:text-3xl">{cur.title}</h2>
                <div className="truncate text-[16px] text-white/70">
                  {cur.artistId ? (
                    <Link href={`/artist/${cur.artistId}`} onClick={close} className="hover:text-white hover:underline">
                      {cur.artist}
                    </Link>
                  ) : (
                    cur.artist
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  navigator.vibrate?.(8);
                  void like([cur]);
                }}
                aria-label={cur.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                className={cn('press flex size-11 shrink-0 items-center justify-center rounded-full', cur.liked ? 'text-[#ff5b2e]' : 'text-white/80')}
              >
                <Heart className={cn('size-7', cur.liked && 'fill-current')} />
              </button>
            </div>
            <div className="mt-4" data-noswipe>
              <SeekBar large below={phone} />
            </div>
            <TransportControls size="lg" className="mt-2 justify-between md:justify-center [&_button]:text-white [&_button[aria-label=Pause]]:bg-white [&_button[aria-label=Play]]:bg-white [&_button[aria-label=Pause]]:text-[#111010] [&_button[aria-label=Play]]:text-[#111010]" />
            {/* phone: sheets for lyrics / queue / EQ */}
            <div className="mt-6 flex items-center justify-between md:hidden">
              <BottomButton icon={<MicVocal />} label="Lyrics" onClick={() => setSide('lyrics')} />
              <BottomButton icon={<ListMusic />} label="Up next" onClick={() => setSide('queue')} />
              <BottomButton icon={<SlidersHorizontal />} label="EQ" onClick={() => setSide('eq')} />
            </div>
            {/* desktop row */}
            <div className="mt-5 flex items-center justify-between gap-2 text-white/80 max-md:hidden">
              <div className="flex items-center gap-1">
                <SleepMenu />
                <SpeedMenu />
                {cur.formats[0] && <span className="ml-1 rounded border border-white/25 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider">{cur.formats[0]}</span>}
              </div>
              <div className="flex items-center gap-1">
                {(['lyrics', 'queue', 'eq'] as Side[]).map((sd) => (
                  <IconButton key={sd} label={SIDE_LABEL[sd]} size="sm" active={desktopSide === sd} onClick={() => setDesktopSide(desktopSide === sd ? null : sd)} className="text-white/80 hover:bg-white/10">
                    {sd === 'lyrics' ? <MicVocal /> : sd === 'queue' ? <ListMusic /> : <SlidersHorizontal />}
                  </IconButton>
                ))}
                <IconButton
                  label="Details"
                  size="sm"
                  onClick={() => {
                    close();
                    usePlayer.getState().setPanel('info');
                  }}
                  className="text-white/80 hover:bg-white/10"
                >
                  <Info />
                </IconButton>
                <VolumeControl />
              </div>
            </div>
          </div>
        </div>
        {desktopSide && (
          <div data-noswipe className="flex min-h-0 animate-fade-in flex-col overflow-hidden rounded-[18px] bg-black/30 max-md:hidden md:w-[44%] md:max-w-[620px]">
            <div className="flex h-12 shrink-0 items-center px-4 text-sm font-bold">{SIDE_LABEL[desktopSide]}</div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {desktopSide === 'lyrics' && <LyricsView />}
              {desktopSide === 'queue' && <QueueView dark />}
              {desktopSide === 'eq' && <EqualizerPanel dark />}
            </div>
          </div>
        )}
      </div>

      <Sheet open={!!side} onOpenChange={(o) => !o && setSide(null)} title={side ? SIDE_LABEL[side] : undefined} full={side !== 'eq'}>
        <div data-noswipe className="h-full">
          {side === 'lyrics' && <LyricsView compact />}
          {side === 'queue' && <QueueView />}
          {side === 'eq' && <EqualizerPanel />}
        </div>
      </Sheet>
    </div>
  );
}

function BottomButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex h-11 items-center gap-2 rounded-full px-3 text-[14px] font-semibold text-white/80 [&_svg]:size-5">
      {icon}
      {label}
    </button>
  );
}

/** Keep the artwork colour in a calm mid-tone band. */
function clampTone(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  // desaturate a little
  const avg = (r + g + b) / 3;
  const sat = max ? (max - min) / max : 0;
  const k = sat > 0.6 ? 0.75 : 1;
  r = avg + (r - avg) * k;
  g = avg + (g - avg) * k;
  b = avg + (b - avg) * k;
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Blurred artwork under a dark scrim, plus a thin spectrum line along the bottom when motion is allowed. */
function Backdrop({ cover, playing, reduce }: { cover: string | null; playing: boolean; reduce: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (reduce) return;
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const engine = getEngine();
    const data = new Uint8Array(256);
    const resize = () => {
      cv.width = cv.clientWidth * Math.min(2, devicePixelRatio);
      cv.height = cv.clientHeight * Math.min(2, devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);
    const draw = () => {
      const a = engine.analyser;
      const w = cv.width;
      const h = cv.height;
      ctx.clearRect(0, 0, w, h);
      if (a && playing) {
        a.getByteFrequencyData(data);
        const bars = 48;
        const bw = w / bars;
        ctx.fillStyle = 'rgba(245,239,230,0.10)';
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i / bars) * 150) + 2] / 255;
          const bh = v * v * h;
          ctx.fillRect(i * bw + bw * 0.25, h - bh, bw * 0.5, bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [playing, reduce]);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-45 blur-[60px]" />
      )}
      <div className="absolute inset-0 bg-black/45" />
      <canvas ref={canvas} className="absolute inset-x-0 bottom-0 h-24 w-full" />
    </div>
  );
}
