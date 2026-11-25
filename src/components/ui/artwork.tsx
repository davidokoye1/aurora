'use client';

import { useState } from 'react';
import { Music2, Disc3, User, ListMusic } from 'lucide-react';
import { cn } from './cn';
import { hashColor } from '@/lib/client/color';

/** Artwork with graceful fallback (seeded gradient + icon) and fade-in. */
export function Artwork({
  src, alt, className, rounded = 'md', kind = 'track', seed, priority,
}: { src?: string | null; alt: string; className?: string; rounded?: 'sm' | 'md' | 'lg' | 'full'; kind?: 'track' | 'album' | 'artist' | 'playlist'; seed?: string; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const r = rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-[14px]' : rounded === 'sm' ? 'rounded-[4px]' : 'rounded-lg';
  const Icon = kind === 'artist' ? User : kind === 'album' ? Disc3 : kind === 'playlist' ? ListMusic : Music2;
  const c = hashColor(seed ?? alt);
  return (
    <div className={cn('relative shrink-0 overflow-hidden bg-surface-3', r, className)} style={!src || failed ? { background: `color-mix(in srgb, ${c} 38%, #1a1918)` } : undefined}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-white/70">
          <Icon className="size-[38%] max-h-16 max-w-16" strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

/** 2x2 mosaic of covers for playlists without custom art. */
export function Mosaic({ covers, alt, className, rounded = 'md', seed }: { covers: string[]; alt: string; className?: string; rounded?: 'sm' | 'md' | 'lg'; seed?: string }) {
  if (covers.length < 4) return <Artwork src={covers[0]} alt={alt} className={className} rounded={rounded} kind="playlist" seed={seed} />;
  const r = rounded === 'lg' ? 'rounded-[14px]' : rounded === 'sm' ? 'rounded-[4px]' : 'rounded-lg';
  return (
    <div className={cn('grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden bg-surface-3', r, className)}>
      {covers.slice(0, 4).map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={c} alt="" loading="lazy" className="size-full object-cover" draggable={false} />
      ))}
    </div>
  );
}
