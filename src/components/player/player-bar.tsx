'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Heart, ListMusic, MicVocal, Maximize2, Info, ChevronUp, SkipForward, Play, Pause } from 'lucide-react';
import { usePlayer } from '@/stores/player';
import { useLike } from '@/lib/client/hooks';
import { Artwork } from '@/components/ui/artwork';
import { IconButton, Spinner } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { SeekBar, TransportControls, VolumeControl, SpeedMenu, SleepMenu } from './controls';

export function PlayerBar() {
  const cur = usePlayer((s) => s.items[s.index]);
  const panel = usePlayer((s) => s.panel);
  const like = useLike();
  const t = cur?.track;
  return (
    <div className="flex h-[84px] items-center gap-4 px-3" role="region" aria-label="Player">
      <div className="flex w-[30%] min-w-0 items-center gap-3.5">
        {t ? (
          <>
            <button onClick={() => usePlayer.getState().setFull(true)} aria-label="Open full-screen player" className="group relative shrink-0">
              <Artwork src={t.cover} alt={t.album ?? t.title} className="size-14 shadow-float" rounded="md" seed={t.album ?? t.title} />
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                <ChevronUp className="size-5" />
              </span>
            </button>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">
                {t.albumId ? (
                  <Link href={`/album/${t.albumId}?track=${t.id}`} className="hover:underline">
                    {t.title}
                  </Link>
                ) : (
                  t.title
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-fg-2">
                {t.artistId ? (
                  <Link href={`/artist/${t.artistId}`} className="hover:text-fg hover:underline">
                    {t.artist}
                  </Link>
                ) : (
                  t.artist
                )}
              </div>
            </div>
            <IconButton label={t.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'} size="sm" active={false} onClick={() => void like([t])} className={cn(t.liked && 'text-accent hover:text-accent')}>
              <Heart className={cn(t.liked && 'fill-current')} />
            </IconButton>
          </>
        ) : (
          <div className="text-sm text-fg-3">Nothing playing</div>
        )}
      </div>
      <div className="flex max-w-[722px] flex-1 flex-col items-center gap-1">
        <TransportControls />
        <SeekBar />
      </div>
      <div className="flex w-[30%] min-w-0 items-center justify-end gap-0.5">
        {t && t.formats[0] && <span className="mr-1 hidden rounded border border-line-strong px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-fg-2 2xl:inline">{t.formats[0]}</span>}
        <div className="max-xl:hidden">
          <SpeedMenu />
        </div>
        <div className="max-lg:hidden">
          <SleepMenu />
        </div>
        <IconButton label="Now playing details" size="sm" active={panel === 'info'} onClick={() => usePlayer.getState().togglePanel('info')} className="max-lg:hidden">
          <Info />
        </IconButton>
        <IconButton label="Lyrics" size="sm" active={panel === 'lyrics'} onClick={() => usePlayer.getState().togglePanel('lyrics')}>
          <MicVocal />
        </IconButton>
        <IconButton label="Queue" size="sm" active={panel === 'queue'} onClick={() => usePlayer.getState().togglePanel('queue')}>
          <ListMusic />
        </IconButton>
        <VolumeControl className="max-lg:hidden" />
        <IconButton label="Full-screen player" size="sm" onClick={() => usePlayer.getState().setFull(true)}>
          <Maximize2 />
        </IconButton>
      </div>
    </div>
  );
}

/** Phone mini player, docked above the tab bar: tap to expand, swipe left/right to skip, swipe up to open. */
export function MiniPlayer() {
  const cur = usePlayer((s) => s.items[s.index]);
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const playing = usePlayer((s) => s.playing);
  const waiting = usePlayer((s) => s.waiting);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  if (!cur) return null;
  const t = cur.track;
  return (
    <div
      className="relative h-[66px] touch-pan-y border-t border-line bg-surface-2"
      onTouchStart={(e) => (start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchMove={(e) => {
        if (!start.current) return;
        const d = e.touches[0].clientX - start.current.x;
        if (Math.abs(d) > Math.abs(e.touches[0].clientY - start.current.y)) setDx(Math.max(-80, Math.min(80, d)));
      }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        setDx(0);
        if (!s) return;
        const ddx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(ddx) > 60 && Math.abs(dy) < 40) {
          navigator.vibrate?.(8);
          if (ddx < 0) usePlayer.getState().next();
          else usePlayer.getState().prev();
        } else if (dy < -40 && Math.abs(ddx) < 40) usePlayer.getState().setFull(true);
      }}
    >
      <div className="flex h-full items-center gap-3 pl-3 pr-1" onClick={() => usePlayer.getState().setFull(true)} role="button" aria-label={`Now playing: ${t.title} by ${t.artist}. Open player`}>
        <Artwork src={t.cover} alt="" className="size-11" rounded="sm" seed={t.album ?? t.title} />
        <div className="min-w-0 flex-1 transition-transform duration-150" style={{ transform: `translateX(${dx}px)` }}>
          <div className="truncate text-[15px] font-semibold leading-tight">{t.title}</div>
          <div className="truncate text-[13px] text-fg-2">{t.artist}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            usePlayer.getState().toggle();
          }}
          aria-label={playing ? 'Pause' : 'Play'}
          className="press flex size-12 items-center justify-center text-fg"
        >
          {waiting && playing ? <Spinner className="size-6" /> : playing ? <Pause className="size-7 fill-current" /> : <Play className="size-7 fill-current" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            usePlayer.getState().next();
          }}
          aria-label="Next"
          className="press flex size-12 items-center justify-center text-fg"
        >
          <SkipForward className="size-6 fill-current" />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-surface-3">
        <div className="h-full bg-accent" style={{ width: `${duration ? Math.min(100, (time / duration) * 100) : 0}%` }} />
      </div>
    </div>
  );
}
