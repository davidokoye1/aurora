'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Sparkles, Flame, Clock, Users, Music2 } from 'lucide-react';
import { api } from '@/lib/client/api';
import type { Stats } from '@/lib/stats-types';
import { Page } from '@/components/layout/page';
import { Tabs, EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { TrackList } from '@/components/media/track-list';
import { Artwork } from '@/components/ui/artwork';
import { ColumnChart, RankBars } from '@/components/media/charts';
import { plural } from '@/lib/client/format';


const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
const mins = (v: number) => `${v.toLocaleString()} min`;

export default function StatsPage() {
  const [range, setRange] = useState<'4w' | '6m' | '1y' | 'all'>('4w');
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['stats', range], queryFn: () => api<Stats>(`/api/stats?range=${range}`) });
  return (
    <Page
      title="Your Stats"
      back
      subtitle="What you’ve been listening to — calculated from your own history."
      actions={
        <Link href="/recap" className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink transition hover:brightness-110">
          <Sparkles className="size-4" /> {new Date().getFullYear()} Recap
        </Link>
      }
    >
      <Tabs value={range} onChange={setRange} options={[{ value: '4w', label: 'Last 4 weeks' }, { value: '6m', label: 'Last 6 months' }, { value: '1y', label: 'Last year' }, { value: 'all', label: 'All time' }]} className="mb-8" />
      {error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[18px]" />)}</div>
      ) : data.plays === 0 ? (
        <EmptyState icon={<BarChart3 />} title="No listening in this period" body="Play some music and your stats will build up here." />
      ) : (
        <div className="space-y-10">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile icon={<Clock />} label="Minutes listened" value={data.minutes.toLocaleString()} sub={`${plural(data.activeDays, 'day')} with music`} />
            <Tile icon={<Music2 />} label="Songs" value={data.distinctTracks.toLocaleString()} sub={`${plural(data.plays, 'play')}`} />
            <Tile icon={<Users />} label="Artists" value={data.distinctArtists.toLocaleString()} sub={data.topArtists[0] ? `Top: ${data.topArtists[0].artist.name}` : ''} />
            <Tile icon={<Flame />} label="Day streak" value={String(data.streak)} sub={`Best: ${plural(data.bestStreak, 'day')}`} />
          </div>
          {data.persona && (
            <div className="rounded-[22px] bg-surface-2 p-6">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Your listening personality</div>
              <div className="mt-1 font-display text-3xl font-bold">{data.persona.title}</div>
              <p className="mt-1 text-sm text-fg-2">{data.persona.blurb}</p>
            </div>
          )}
          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <h2 className="mb-4 font-display text-2xl font-bold">Top artists</h2>
              <ol className="space-y-2">
                {data.topArtists.slice(0, 8).map((a, i) => (
                  <li key={a.artist.id}>
                    <Link href={`/artist/${a.artist.id}`} className="flex items-center gap-4 rounded-xl p-2 transition hover:bg-hover">
                      <span className="w-5 text-right font-display text-lg font-bold text-fg-3">{i + 1}</span>
                      <Artwork src={a.artist.image} alt="" className="size-12" rounded="full" kind="artist" seed={a.artist.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{a.artist.name}</div>
                        <div className="text-[13px] text-fg-2">{mins(a.minutes)} · {plural(a.plays, 'play')}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h2 className="mb-4 font-display text-2xl font-bold">Top genres</h2>
              {data.topGenres.length ? <RankBars rows={data.topGenres.slice(0, 8).map((g) => ({ label: g.label, value: Math.round(g.share * 100) }))} format={(v) => `${v}%`} /> : <p className="text-sm text-fg-2">Not enough genre information yet.</p>}
            </section>
          </div>
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold">Top songs</h2>
            <TrackList rows={data.topTracks.slice(0, 20).map((t) => ({ key: t.track.id, track: t.track, meta: <span className="text-fg-3"> · {plural(t.plays, 'play')}</span> }))} context={{ type: 'other', title: 'Your top songs', href: '/stats' }} variant="search" />
          </section>
          <div className="grid gap-10 lg:grid-cols-2">
            <section className="rounded-[22px] bg-surface-2 p-6">
              <h2 className="font-display text-xl font-bold">When you listen</h2>
              <p className="mb-5 text-sm text-fg-2">Minutes by hour of day{data.peakHour != null ? ` · peak around ${hourLabel(data.peakHour)}` : ''}</p>
              <ColumnChart data={data.hours} labels={data.hours.map((_, h) => hourLabel(h))} format={mins} title="Minutes listened by hour" tickEvery={3} />
            </section>
            <section className="rounded-[22px] bg-surface-2 p-6">
              <h2 className="font-display text-xl font-bold">Your week</h2>
              <p className="mb-5 text-sm text-fg-2">Minutes by day of week</p>
              <ColumnChart data={[1, 2, 3, 4, 5, 6, 0].map((d) => data.weekdays[d])} labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} format={mins} title="Minutes listened by weekday" />
            </section>
          </div>
        </div>
      )}
    </Page>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[18px] bg-surface-2 p-5">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-fg-2 [&_svg]:size-4">{icon}{label}</div>
      <div className="mt-2 font-display text-4xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 truncate text-[13px] text-fg-3">{sub}</div>}
    </div>
  );
}
