'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X, Play, Sparkles } from 'lucide-react';
import { api } from '@/lib/client/api';
import type { Stats } from '@/lib/stats-types';
import { Artwork } from '@/components/ui/artwork';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/button';
import { usePlayer } from '@/stores/player';
import { plural } from '@/lib/client/format';
import { cn } from '@/components/ui/cn';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function RecapPage() {
  const year = new Date().getFullYear();
  const [y, setY] = useState(year);
  const { data, isLoading } = useQuery({ queryKey: ['recap', y], queryFn: () => api<Stats>(`/api/stats?year=${y}`) });
  const [i, setI] = useState(0);
  const slides = data ? buildSlides(data, y) : [];
  useEffect(() => setI(0), [y]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(slides.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [slides.length]);
  if (isLoading) return <div className="flex h-[70vh] items-center justify-center"><Spinner className="size-8" /></div>;
  if (!data || data.plays < 3)
    return (
      <div className="pt-24">
        <EmptyState icon={<Sparkles />} title={`Your ${y} Recap is still being written`} body="Listen to some music this year and come back — your recap fills in as you play." action={<><Button onClick={() => setY(y - 1)}>See {y - 1}</Button><Link href="/" className="rounded-full bg-fg px-5 py-2.5 text-sm font-semibold text-bg">Start listening</Link></>} />
      </div>
    );
  const s = slides[i];
  return (
    <div className="flex min-h-[calc(100dvh-180px)] items-center justify-center px-4 pb-10 pt-6 md:pt-20">
      <div className="relative aspect-[9/16] w-full max-w-[400px] overflow-hidden rounded-[28px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" style={{ background: s.bg }}>
        <div className="absolute inset-x-3 top-3 z-20 flex gap-1">
          {slides.map((_, k) => (
            <button key={k} aria-label={`Slide ${k + 1}`} onClick={() => setI(k)} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <span className={cn('block h-full bg-white transition-all duration-500', k <= i ? 'w-full' : 'w-0')} />
            </button>
          ))}
        </div>
        <Link href="/stats" aria-label="Close recap" className="absolute right-3 top-6 z-20 rounded-full p-2 text-white/80 hover:bg-white/10"><X className="size-5" /></Link>
        <div key={i} className="relative z-10 flex h-full animate-rise flex-col justify-center p-8 text-white">{s.body}</div>
        <button aria-label="Previous" onClick={() => setI(Math.max(0, i - 1))} className="absolute inset-y-0 left-0 z-10 w-1/3" />
        <button aria-label="Next" onClick={() => setI(Math.min(slides.length - 1, i + 1))} className="absolute inset-y-0 right-0 z-10 w-1/3" />
      </div>
      <div className="ml-6 hidden flex-col gap-3 md:flex">
        <Button size="sm" icon={<ChevronLeft className="size-4" />} onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>Back</Button>
        <Button size="sm" variant="primary" icon={<ChevronRight className="size-4" />} onClick={() => setI(Math.min(slides.length - 1, i + 1))} disabled={i === slides.length - 1}>Next</Button>
        <Button size="sm" variant="ghost" onClick={() => setY(y - 1)}>{y - 1} recap</Button>
      </div>
    </div>
  );
}

function buildSlides(d: Stats, y: number) {
  const topMonth = d.months.indexOf(Math.max(...d.months));
  const slides: { bg: string; body: React.ReactNode }[] = [
    {
      bg: '#ff5b2e',
      body: (
        <>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Aurora Recap</div>
          <div className="mt-3 font-display text-6xl font-bold leading-none">{y}</div>
          <p className="mt-6 text-lg text-white/85">Your year in music, from your own library. Tap to continue.</p>
        </>
      ),
    },
    {
      bg: '#2f7d6d',
      body: (
        <>
          <p className="text-lg text-white/85">You listened for</p>
          <div className="mt-2 font-display text-7xl font-bold tabular-nums">{d.minutes.toLocaleString()}</div>
          <p className="mt-1 text-2xl font-semibold">minutes</p>
          <p className="mt-6 text-white/80">That’s {Math.round(d.minutes / 60).toLocaleString()} hours across {plural(d.activeDays, 'day')}. {MONTHS[topMonth]} was your biggest month.</p>
        </>
      ),
    },
  ];
  if (d.topArtists[0])
    slides.push({
      bg: '#d9a23c',
      body: (
        <>
          <p className="text-lg text-white/85">Your top artist</p>
          <Artwork src={d.topArtists[0].artist.image} alt="" className="mt-5 size-40 shadow-2xl" rounded="full" kind="artist" seed={d.topArtists[0].artist.name} />
          <div className="mt-5 font-display text-4xl font-bold leading-tight">{d.topArtists[0].artist.name}</div>
          <p className="mt-2 text-white/85">{d.topArtists[0].minutes.toLocaleString()} minutes together</p>
          <ol className="mt-6 space-y-1 text-white/90">
            {d.topArtists.slice(1, 5).map((a, k) => (
              <li key={a.artist.id}><span className="mr-2 font-display font-bold">{k + 2}</span>{a.artist.name}</li>
            ))}
          </ol>
        </>
      ),
    });
  if (d.topTracks[0])
    slides.push({
      bg: '#1f2a44',
      body: (
        <>
          <p className="text-lg text-white/85">Your song of the year</p>
          <Artwork src={d.topTracks[0].track.cover} alt="" className="mt-5 size-44 shadow-2xl" rounded="lg" seed={d.topTracks[0].track.title} />
          <div className="mt-5 font-display text-3xl font-bold leading-tight">{d.topTracks[0].track.title}</div>
          <p className="mt-1 text-white/80">{d.topTracks[0].track.artist} · {plural(d.topTracks[0].plays, 'play')}</p>
          <button
            className="relative z-20 mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"
            onClick={(e) => {
              e.stopPropagation();
              usePlayer.getState().playTracks(d.topTracks.map((t) => t.track), { context: { type: 'other', title: `Top songs of ${y}`, href: '/recap' } });
            }}
          >
            <Play className="size-4 fill-current" /> Play your top songs
          </button>
        </>
      ),
    });
  if (d.topGenres[0])
    slides.push({
      bg: '#5b7080',
      body: (
        <>
          <p className="text-lg text-white/85">Your sound was</p>
          <div className="mt-2 font-display text-5xl font-bold">{d.topGenres[0].label}</div>
          <ul className="mt-8 space-y-3">
            {d.topGenres.slice(0, 5).map((g) => (
              <li key={g.id}>
                <div className="flex justify-between text-sm"><span>{g.label}</span><span className="tabular-nums">{Math.round(g.share * 100)}%</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-white/20"><div className="h-full rounded-full bg-white" style={{ width: `${g.share * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </>
      ),
    });
  if (d.persona)
    slides.push({
      bg: '#9a6a4f',
      body: (
        <>
          <p className="text-lg text-white/85">Your listening personality</p>
          <div className="mt-3 font-display text-5xl font-bold leading-tight">{d.persona.title}</div>
          <p className="mt-4 text-lg text-white/85">{d.persona.blurb}</p>
          <p className="mt-8 text-sm text-white/70">{plural(d.distinctArtists, 'artist')} · {plural(d.distinctTracks, 'song')} · best streak {plural(d.bestStreak, 'day')}</p>
        </>
      ),
    });
  slides.push({
    bg: '#ff5b2e',
    body: (
      <>
        <div className="font-display text-4xl font-bold leading-tight">Thanks for listening.</div>
        <p className="mt-4 text-lg text-white/85">Here’s to another year of great music.</p>
        <Link href="/stats" className="relative z-20 mt-8 inline-flex w-fit rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">See all your stats</Link>
      </>
    ),
  });
  return slides;
}
