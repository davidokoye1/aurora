'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Shuffle } from 'lucide-react';
import type { Track } from '@/lib/types';
import { usePlayer, type PlayContext } from '@/stores/player';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/button';
import { dominantColor, mixColor, MIX_COLORS } from '@/lib/client/color';
import { toast } from '@/stores/ui';

/** Play button that knows whether this context is the one currently playing. */
export function PlayFab({ context, load, size = 'md', className, shuffle }: { context: PlayContext; load: () => Promise<Track[]> | Track[]; size?: 'sm' | 'md' | 'lg'; className?: string; shuffle?: boolean }) {
  const active = usePlayer((s) => s.context?.type === context.type && s.context?.id === context.id && s.index >= 0);
  const playing = usePlayer((s) => s.playing);
  const [busy, setBusy] = useState(false);
  const on = active && playing;
  return (
    <button
      aria-label={on ? `Pause ${context.title}` : `Play ${context.title}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (active) return usePlayer.getState().toggle();
        setBusy(true);
        try {
          const tracks = await load();
          if (!tracks.length) toast.info('Nothing to play here yet.');
          else usePlayer.getState().playTracks(tracks, { context, shuffle: shuffle ?? usePlayer.getState().shuffle });
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-all duration-150 hover:brightness-110 active:scale-95',
        size === 'sm' && 'size-10 [&_svg]:size-4',
        size === 'md' && 'size-12 [&_svg]:size-5',
        size === 'lg' && 'size-14 [&_svg]:size-6',
        busy && 'animate-pulse',
        className,
      )}
    >
      {on ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
    </button>
  );
}

export function ShuffleButton({ onClick }: { onClick: () => void }) {
  const on = usePlayer((s) => s.shuffle);
  return (
    <IconButton label={on ? 'Disable shuffle' : 'Enable shuffle'} active={on} size="lg" onClick={onClick}>
      <Shuffle />
    </IconButton>
  );
}

export interface CardProps {
  href: string;
  title: string;
  subtitle?: ReactNode;
  cover?: string | null;
  covers?: string[];
  kind: 'album' | 'playlist' | 'artist' | 'mix';
  color?: string;
  badge?: ReactNode;
  context?: PlayContext;
  load?: () => Promise<Track[]> | Track[];
  overlayTitle?: string;
}

export function MediaCard({ href, title, subtitle, cover, covers, kind, color, badge, context, load, overlayTitle }: CardProps) {
  return (
    <Link href={href} className="press group relative block min-w-0 animate-rise rounded-[12px] p-1.5 transition-colors duration-200 md:p-2.5 md:hover:bg-hover focus-visible:bg-hover">
      <div className="relative aspect-square w-full">
        {kind === 'mix' ? (
          <MixArt covers={covers ?? []} color={color} title={overlayTitle ?? title} />
        ) : kind === 'artist' ? (
          <Artwork src={cover} alt={title} className="size-full" rounded="full" kind="artist" seed={title} />
        ) : covers && covers.length >= 4 && !cover ? (
          <Mosaic covers={covers} alt={title} className="size-full" rounded="lg" />
        ) : (
          <Artwork src={cover ?? covers?.[0]} alt={title} className="size-full" rounded="lg" kind={kind === 'playlist' ? 'playlist' : 'album'} seed={title} />
        )}
        {context && load && (
          <div className="absolute bottom-2 right-2 translate-y-2 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 max-md:hidden">
            <PlayFab context={context} load={load} />
          </div>
        )}
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
      </div>
      <div className={cn('mt-2 min-w-0 md:mt-3', kind === 'artist' && 'text-center')}>
        <div className="truncate text-[15px] font-semibold">{title}</div>
        {subtitle && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-fg-2">{subtitle}</div>}
      </div>
    </Link>
  );
}

export { MIX_COLORS, mixColor };
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.52 ? '#111010' : '#f5efe6';
}

/** Generated cover for mixes: a flat colour block, a strip of artwork and a poster-style title. */
export function MixArt({ covers, color, title, className }: { covers: string[]; color?: string; title: string; className?: string }) {
  const bg = mixColor(title) ?? color;
  const ink = inkOn(bg);
  return (
    <div className={cn('relative flex size-full flex-col justify-between overflow-hidden rounded-[10px] p-[9%]', className)} style={{ background: bg, color: ink, containerType: 'inline-size' } as React.CSSProperties}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-80">Aurora mix</span>
        {covers.length > 0 && (
          <div className="grid w-[38%] shrink-0 grid-cols-2 gap-[2px] overflow-hidden rounded-[4px]">
            {covers.slice(0, 4).map((c, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={c} alt="" loading="lazy" className={cn('aspect-square w-full object-cover', covers.length < 4 && i === 0 && 'col-span-2 row-span-2')} />
            ))}
          </div>
        )}
      </div>
      <div className="font-display text-[clamp(17px,13cqw,34px)] font-extrabold leading-[0.95]">
        {title}
      </div>
    </div>
  );
}

/** Horizontally scrolling row with arrow controls. */
export function Shelf({ title, subtitle, href, children, className }: { title: ReactNode; subtitle?: ReactNode; href?: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className={cn('relative', className)}>
      <div className="mb-1.5 flex items-end justify-between gap-4 px-1.5 md:mb-2 md:px-2.5">
        <div className="min-w-0">
          <h2 className="font-display text-[21px] font-extrabold md:text-2xl">
            {href ? (
              <Link href={href} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-fg-2">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-[13px] font-semibold text-fg-2 md:hidden">
            See all
          </Link>
        )}
        <div className="flex shrink-0 items-center gap-1 max-md:hidden">
          {href && (
            <Link href={href} className="mr-2 text-[13px] font-semibold text-fg-2 hover:text-fg hover:underline">
              Show all
            </Link>
          )}
          <IconButton label="Scroll left" size="sm" disabled={!edges.left} onClick={() => scroll(-1)} className="bg-surface-2">
            <ChevronLeft />
          </IconButton>
          <IconButton label="Scroll right" size="sm" disabled={!edges.right} onClick={() => scroll(1)} className="bg-surface-2">
            <ChevronRight />
          </IconButton>
        </div>
      </div>
      <div ref={ref} onScroll={update} className="no-scrollbar -mx-1 grid snap-x snap-mandatory auto-cols-[40%] grid-flow-col scroll-px-1 overflow-x-auto scroll-smooth px-1 sm:auto-cols-[minmax(160px,30%)] md:auto-cols-[minmax(170px,22%)] lg:auto-cols-[minmax(180px,18%)] 2xl:auto-cols-[minmax(190px,14.2%)] [&>*]:snap-start">
        {children}
      </div>
    </section>
  );
}

export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3 md:gap-1 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-7', className)}>{children}</div>;
}

export function CardSkeletons({ n = 6, round }: { n?: number; round?: boolean }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="p-2.5">
          <div className={cn('skeleton aspect-square w-full', round ? 'rounded-full' : 'rounded-[14px]')} />
          <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded" />
        </div>
      ))}
    </>
  );
}

/** Page header: centered artwork on phones, side-by-side on desktop; a short artwork-tinted band behind it. */
export function PageHero({
  art, eyebrow, title, meta, description, color, round, actions,
}: { art: ReactNode; eyebrow?: ReactNode; title: string; meta?: ReactNode; description?: ReactNode; color?: string | null; round?: boolean; actions?: ReactNode }) {
  const c = color ?? 'var(--surface-2)';
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-[340px] transition-[background] duration-700 md:h-[420px]" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${c} 55%, var(--bg)) 0%, var(--bg) 100%)` }} />
      <div className="safe-top md:hidden" aria-hidden><div className="h-14" /></div>
      <div className="relative flex flex-col gap-5 px-4 pb-2 pt-2 md:flex-row md:items-end md:gap-6 md:px-8 md:pb-6 md:pt-10">
        <div className={cn('mx-auto w-[min(64vw,260px)] shrink-0 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.75)] md:mx-0 md:w-56 lg:w-60', round ? 'rounded-full' : 'rounded-[12px]')}>{art}</div>
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-2 max-md:hidden">{eyebrow}</div>}
          <h1 className="text-balance font-display text-[28px] font-extrabold leading-[1.02] md:mt-2 md:text-5xl lg:text-6xl xl:text-7xl">{title}</h1>
          {description && <div className="mt-2 line-clamp-3 text-sm text-fg-2">{description}</div>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-fg-2 md:mt-3 md:text-sm">{meta}</div>}
        </div>
      </div>
      {actions && <div className="relative flex items-center gap-3 px-4 pb-4 md:px-8">{actions}</div>}
    </div>
  );
}

export function useArtColor(src: string | null | undefined) {
  const [c, setC] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void dominantColor(src).then((v) => live && setC(v));
    return () => {
      live = false;
    };
  }, [src]);
  return c;
}
