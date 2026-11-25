'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume, Volume1, Volume2, VolumeX, Moon, Gauge, Check } from 'lucide-react';
import { usePlayer } from '@/stores/player';
import { getEngine } from '@/lib/client/audio-engine';
import { fmtTime } from '@/lib/client/format';
import { IconButton, Spinner } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { cn } from '@/components/ui/cn';

/** Smooth progress bar: reads engine time every animation frame while playing. */
export function SeekBar({ className, large, showTimes = true, below }: { className?: string; large?: boolean; showTimes?: boolean; below?: boolean }) {
  const duration = usePlayer((s) => s.duration);
  const storeTime = usePlayer((s) => s.time);
  const buffered = usePlayer((s) => s.buffered);
  const playing = usePlayer((s) => s.playing);
  const hasTrack = usePlayer((s) => s.index >= 0);
  const [drag, setDrag] = useState<number | null>(null);
  const [t, setT] = useState(storeTime);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    setT(storeTime);
  }, [storeTime]);
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      try {
        setT(getEngine().time);
      } catch {}
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing]);
  const shown = drag ?? t;
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;
  const bpct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const commit = () => {
    if (drag != null) usePlayer.getState().seek(drag);
    setDrag(null);
  };
  const bar = (
    <div className="relative flex-1">
      <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full" style={{ background: `linear-gradient(to right, transparent ${pct}%, color-mix(in srgb, currentColor 22%, transparent) ${pct}%, color-mix(in srgb, currentColor 22%, transparent) ${bpct}%, transparent ${bpct}%)` }} />
      <input
        type="range"
        aria-label="Seek"
        aria-valuetext={`${fmtTime(shown)} of ${fmtTime(duration)}`}
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(shown, duration || 1)}
        disabled={!hasTrack || !duration}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className={cn('slider relative block', large && 'slider-lg')}
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </div>
  );
  if (below)
    return (
      <div className={cn('w-full', className)}>
        {bar}
        <div className="mt-1 flex justify-between text-[12px] tabular-nums opacity-70">
          <span>{fmtTime(shown)}</span>
          <span>-{fmtTime(Math.max(0, duration - shown))}</span>
        </div>
      </div>
    );
  return (
    <div className={cn('flex w-full items-center gap-2', className)}>
      {showTimes && <span className="w-10 text-right text-[11px] tabular-nums text-fg-2">{fmtTime(shown)}</span>}
      {bar}
      {showTimes && <span className="w-10 text-[11px] tabular-nums text-fg-2">{fmtTime(duration)}</span>}
    </div>
  );
}

export function PlayPause({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const playing = usePlayer((s) => s.playing);
  const waiting = usePlayer((s) => s.waiting);
  const has = usePlayer((s) => s.index >= 0);
  return (
    <button
      onClick={() => usePlayer.getState().toggle()}
      disabled={!has}
      aria-label={playing ? 'Pause' : 'Play'}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40',
        size === 'sm' && 'size-8 [&_svg]:size-4',
        size === 'md' && 'size-9 [&_svg]:size-[18px]',
        size === 'lg' && 'size-14 [&_svg]:size-6',
        size === 'xl' && 'size-[72px] [&_svg]:size-8',
        className,
      )}
    >
      {waiting && playing ? <Spinner className="size-1/2" /> : playing ? <Pause className="fill-current" /> : <Play className="ml-[2px] fill-current" />}
    </button>
  );
}

export function TransportControls({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const has = usePlayer((s) => s.index >= 0);
  const big = size === 'lg';
  return (
    <div className={cn('flex items-center justify-center', big ? 'gap-5' : 'gap-2', className)}>
      <IconButton label={shuffle ? 'Disable shuffle' : 'Enable shuffle'} active={shuffle} size={big ? 'lg' : 'sm'} onClick={() => usePlayer.getState().setShuffle()}>
        <Shuffle />
      </IconButton>
      <IconButton label="Previous" size={big ? 'lg' : 'md'} disabled={!has} onClick={() => usePlayer.getState().prev()} className="text-fg">
        <SkipBack className="fill-current" />
      </IconButton>
      <PlayPause size={big ? 'xl' : 'md'} />
      <IconButton label="Next" size={big ? 'lg' : 'md'} disabled={!has} onClick={() => usePlayer.getState().next()} className="text-fg">
        <SkipForward className="fill-current" />
      </IconButton>
      <IconButton label={repeat === 'off' ? 'Enable repeat' : repeat === 'all' ? 'Repeat one' : 'Disable repeat'} active={repeat !== 'off'} size={big ? 'lg' : 'sm'} onClick={() => usePlayer.getState().cycleRepeat()}>
        {repeat === 'one' ? <Repeat1 /> : <Repeat />}
      </IconButton>
    </div>
  );
}

export function VolumeControl({ className }: { className?: string }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const v = muted ? 0 : volume;
  const Icon = v === 0 ? VolumeX : v < 0.33 ? Volume : v < 0.66 ? Volume1 : Volume2;
  return (
    <div className={cn('group flex items-center gap-1', className)}>
      <IconButton label={muted ? 'Unmute' : 'Mute'} size="sm" onClick={() => usePlayer.getState().toggleMute()}>
        <Icon />
      </IconButton>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => usePlayer.getState().setVolume(Number(e.target.value))}
        onWheel={(e) => usePlayer.getState().setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        className="slider w-24"
        style={{ ['--pct' as string]: `${v * 100}%` }}
      />
    </div>
  );
}

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export function SpeedMenu() {
  const speed = usePlayer((s) => s.speed);
  return (
    <Menu
      side="top"
      trigger={
        <button aria-label={`Playback speed ${speed}×`} className={cn('flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums transition hover:bg-hover', speed !== 1 ? 'text-accent' : 'text-fg-2 hover:text-fg')}>
          <Gauge className="size-4" />
          {speed !== 1 && `${speed}×`}
        </button>
      }
      items={SPEEDS.map((s) => ({ label: s === 1 ? 'Normal (1×)' : `${s}×`, checked: s === speed, onSelect: () => usePlayer.getState().setSpeed(s) }))}
    />
  );
}

export function SleepMenu() {
  const sleep = usePlayer((s) => s.sleep);
  const [, force] = useState(0);
  useEffect(() => {
    if (!sleep?.until) return;
    const i = setInterval(() => force((x) => x + 1), 15_000);
    return () => clearInterval(i);
  }, [sleep]);
  const remaining = sleep?.until ? Math.max(0, Math.ceil((sleep.until - Date.now()) / 60000)) : null;
  const opt = (m: number | 'end', label: string) => ({ label, onSelect: () => usePlayer.getState().setSleep(m) });
  return (
    <Menu
      side="top"
      trigger={
        <button aria-label="Sleep timer" className={cn('flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums transition hover:bg-hover', sleep ? 'text-accent' : 'text-fg-2 hover:text-fg')}>
          <Moon className="size-4" />
          {sleep && (sleep.endOfTrack ? 'End' : `${remaining}m`)}
        </button>
      }
      items={[
        opt(5, '5 minutes'),
        opt(15, '15 minutes'),
        opt(30, '30 minutes'),
        opt(45, '45 minutes'),
        opt(60, '1 hour'),
        opt(90, '1.5 hours'),
        opt('end', 'End of track'),
        ...(sleep ? [{ separator: true, label: '' }, { label: 'Turn off sleep timer', icon: <Check />, onSelect: () => usePlayer.getState().setSleep(null) }] : []),
      ]}
    />
  );
}
