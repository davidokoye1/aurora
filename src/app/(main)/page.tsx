'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Heart, Upload, Link2, Server, Sparkles, Play, History, BarChart3, Plus, Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/client/api';
import { greeting, plural } from '@/lib/client/format';
import { useMe } from '@/lib/client/hooks';
import { loadAlbum, loadArtist, loadLiked, loadMix, loadMood, loadPlaylist } from '@/lib/client/loaders';
import type { HomeData } from '@/lib/server/home';
import { Page } from '@/components/layout/page';
import { MediaCard, Shelf, PlayFab, CardSkeletons, mixColor } from '@/components/media/cards';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { ErrorState, Skeleton, Chip } from '@/components/ui/misc';
import { MobileTop, TopIcon } from '@/components/layout/mobile-top';
import { usePlayer } from '@/stores/player';
import { cn } from '@/components/ui/cn';
import { MoodTile } from '@/components/media/mood-tile';
import { ScanBanner } from '@/components/sources/scan-banner';

export default function HomePage() {
  const me = useMe();
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home'), staleTime: 60_000 });
  const [filter, setFilter] = useState('all');
  const empty = !!data && data.stats.tracks === 0;

  if (error) return <Page><ErrorState error={error} retry={() => refetch()} /></Page>;

  const FILTERS: Record<string, string[] | null> = { all: null, mixes: ['mixes', 'discover', 'moods', 'forgotten'], albums: ['added', 'albums', 'recent'], artists: ['artists'] };
  const shownSections = data ? data.order.filter((k) => !FILTERS[filter] || FILTERS[filter]!.includes(k)) : [];

  return (
    <div className="animate-fade-in">
      <MobileTop
        title={greeting(me.name)}
        right={
          <>
            <TopIcon label="Recently played" href="/history"><History /></TopIcon>
            <TopIcon label="Your stats" href="/stats"><BarChart3 /></TopIcon>
            <TopIcon label="Music sources" href="/sources"><Plus /></TopIcon>
          </>
        }
      />
      <div className="space-y-8 px-4 md:space-y-12 md:px-8 md:pt-20">
      <ScanBanner />
      <section>
        <h1 className="font-display text-[40px] font-extrabold max-md:hidden">{greeting(me.name)}</h1>
        {data && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:mt-5 md:px-0">
            {[['all', 'All'], ['mixes', 'Mixes'], ['albums', 'Albums'], ['artists', 'Artists']].map(([k, l]) => (
              <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>
            ))}
            <Link href="/discover" className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[13px] font-medium"><Wand2 className="size-3.5 text-accent" /> Make a mix</Link>
            <Link href="/library?tab=podcasts" className="press flex h-8 shrink-0 items-center rounded-full bg-surface-2 px-3.5 text-[13px] font-medium">Podcasts</Link>
          </div>
        )}
        {isLoading || !data ? (
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg md:h-16" />
            ))}
          </div>
        ) : data.stats.tracks === 0 ? null : (
          data.quick.length > 0 && filter === 'all' && (
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {data.quick.map((q) => (
                <QuickTile key={`${q.kind}-${q.id}`} q={q} />
              ))}
            </div>
          )
        )}
      </section>

      {isLoading && (
        <>
          {[0, 1].map((i) => (
            <div key={i}>
              <Skeleton className="mb-4 h-6 w-48" />
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                <CardSkeletons n={6} />
              </div>
            </div>
          ))}
        </>
      )}

      {data && data.stats.tracks > 0 && shownSections.map((key) => <Section key={key} id={key} data={data} />)}
      {empty && <Onboarding isAdmin={me.isAdmin} />}

      {data && data.stats.tracks > 0 && !data.hasHistory && (
        <div className="rounded-[22px] bg-surface-2 p-6 md:p-8">
          <div className="flex items-start gap-4">
            <Sparkles className="mt-1 size-6 shrink-0 text-accent" />
            <div>
              <h3 className="font-display text-xl font-bold">Aurora learns from you</h3>
              <p className="mt-1 max-w-2xl text-sm text-fg-2">
                Play, like, skip and add songs to playlists — your mixes, Discover Weekly and radio get sharper with every listen. You have {plural(data.stats.tracks, 'song')} from {plural(data.stats.artists, 'artist')} ready to go.
              </p>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function Section({ id, data }: { id: string; data: HomeData }) {
  switch (id) {
    case 'recent':
      if (!data.recentContexts.length && !data.recent.length) return null;
      return (
        <Shelf title="Recently played" href="/history">
          {data.recentContexts.map((c) => (
            <MediaCard
              key={`${c.kind}-${c.id}`}
              href={`/${c.kind === 'mix' ? 'mix' : c.kind}/${c.id}`}
              title={c.title}
              subtitle={c.subtitle}
              cover={c.cover}
              kind={c.kind === 'artist' ? 'artist' : c.kind === 'playlist' ? 'playlist' : 'album'}
              context={{ type: c.kind as 'album', id: c.id, title: c.title, href: `/${c.kind}/${c.id}` }}
              load={() => (c.kind === 'album' ? loadAlbum(c.id) : c.kind === 'playlist' ? loadPlaylist(c.id) : c.kind === 'artist' ? loadArtist(c.id) : loadMix(c.id))}
            />
          ))}
          {data.recent
            .filter((t) => !data.recentContexts.some((c) => c.kind === 'album' && c.id === t.albumId))
            .slice(0, 12)
            .map((t, i) => (
              <TrackCard key={t.id + i} track={t} onPlay={() => usePlayer.getState().playTracks(data.recent, { startIndex: data.recent.indexOf(t), context: { type: 'history', title: 'Recently played', href: '/history' } })} />
            ))}
        </Shelf>
      );
    case 'mixes':
      if (!data.mixes.length) return null;
      return (
        <Shelf title="Made for you" subtitle="Daily mixes tuned to your taste — refreshed every day">
          {data.mixes.map((m) => (
            <MediaCard key={m.id} href={`/mix/${m.id}`} title={m.title} subtitle={m.subtitle} covers={m.covers} color={m.color} kind="mix" context={{ type: 'mix', id: m.id, title: m.title, href: `/mix/${m.id}` }} load={() => m.tracks} />
          ))}
        </Shelf>
      );
    case 'discover':
      if (!data.discover.length) return null;
      return (
        <Shelf title="Your discoveries" subtitle="Fresh picks and the songs on heavy rotation">
          {data.discover.map((m) => (
            <MediaCard key={m.id} href={`/mix/${m.id}`} title={m.title} subtitle={m.subtitle} covers={m.covers} color={m.color} kind="mix" context={{ type: 'mix', id: m.id, title: m.title, href: `/mix/${m.id}` }} load={() => m.tracks} />
          ))}
          <MediaCard href="/mix/recent" title="Recently Added" subtitle="The newest arrivals in your library" covers={data.added.slice(0, 4).map((a) => a.cover).filter(Boolean) as string[]} color="#2fae9a" kind="mix" context={{ type: 'mix', id: 'recent', title: 'Recently Added', href: '/mix/recent' }} load={() => loadMix('recent')} />
        </Shelf>
      );
    case 'added':
      if (!data.added.length) return null;
      return (
        <Shelf title="New in your library" href="/library?tab=albums&sort=added">
          {data.added.map((a) => (
            <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={a.artist ?? 'Album'} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />
          ))}
        </Shelf>
      );
    case 'albums':
      if (!data.albums.length) return null;
      return (
        <Shelf title="Albums for you" subtitle="Records in your library that match what you love">
          {data.albums.map((a) => (
            <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={[a.artist, a.year].filter(Boolean).join(' · ')} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />
          ))}
        </Shelf>
      );
    case 'artists':
      if (!data.artists.length) return null;
      return (
        <Shelf title={data.hasHistory ? 'Your top artists' : 'Artists in your library'} href="/library?tab=artists">
          {data.artists.map((a) => (
            <MediaCard key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle="Artist" cover={a.image} kind="artist" context={{ type: 'artist', id: a.id, title: a.name, href: `/artist/${a.id}` }} load={() => loadArtist(a.id)} />
          ))}
        </Shelf>
      );
    case 'moods':
      if (!data.moods.length) return null;
      return (
        <section>
          <div className="mb-3 flex items-end justify-between px-1.5 md:px-2.5">
            <h2 className="font-display text-[21px] font-extrabold md:text-2xl">Moods & moments</h2>
            <Link href="/discover" className="text-[13px] font-semibold text-fg-2 hover:text-fg hover:underline">
              See all
            </Link>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-3 md:px-2.5 lg:grid-cols-5 [&>*]:w-[42%] [&>*]:shrink-0 [&>*]:snap-start md:[&>*]:w-auto">
            {data.moods.map((m) => (
              <MoodTile key={m.id} mood={m} />
            ))}
          </div>
        </section>
      );
    case 'forgotten':
      if (!data.forgotten) return null;
      return (
        <Shelf title="Forgotten favorites" subtitle="Songs you loved and haven’t heard in a while">
          {data.forgotten.tracks.slice(0, 16).map((t, i) => (
            <TrackCard key={t.id} track={t} onPlay={() => usePlayer.getState().playTracks(data.forgotten!.tracks, { startIndex: i, context: { type: 'mix', id: 'forgotten', title: 'Forgotten Favorites', href: '/mix/forgotten' } })} />
          ))}
        </Shelf>
      );
    case 'quick':
    default:
      return null;
  }
}

function QuickTile({ q }: { q: HomeData['quick'][number] }) {
  const href = q.kind === 'liked' ? '/liked' : `/${q.kind}/${q.id}`;
  const load = () => (q.kind === 'liked' ? loadLiked() : q.kind === 'playlist' ? loadPlaylist(q.id) : q.kind === 'album' ? loadAlbum(q.id) : loadMix(q.id));
  const art: ReactNode =
    q.kind === 'liked' ? (
      <div className="flex size-14 shrink-0 items-center justify-center bg-accent md:size-16">
        <Heart className="size-6 fill-[var(--accent-ink)] text-[var(--accent-ink)]" />
      </div>
    ) : q.cover ? (
      <Artwork src={q.cover} alt="" className="size-14 md:size-16" rounded="sm" />
    ) : q.kind === 'mix' ? (
      <div className="flex size-14 shrink-0 items-end p-1.5 font-display text-[12px] font-extrabold leading-none text-[#111010] md:size-16" style={{ background: mixColor(q.title) }}>
        {q.title.replace(/^Daily Mix/, 'Mix')}
      </div>
    ) : (
      <Mosaic covers={q.covers} alt="" className="size-14 md:size-16" rounded="sm" seed={q.title} />
    );
  return (
    <Link href={href} className="press group relative flex h-14 items-center gap-3 overflow-hidden rounded-[8px] bg-surface-2 pr-3 transition hover:bg-surface-3 md:h-16">
      {art}
      <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-tight md:text-sm">{q.title}</span>
      <span className="opacity-0 transition group-hover:opacity-100 max-md:hidden">
        <PlayFab size="sm" context={{ type: q.kind === 'liked' ? 'liked' : q.kind, id: q.id, title: q.title, href }} load={load} />
      </span>
    </Link>
  );
}

function TrackCard({ track, onPlay }: { track: HomeData['recent'][number]; onPlay: () => void }) {
  const isCur = usePlayer((s) => s.items[s.index]?.track.id === track.id);
  return (
    <div className="group relative min-w-0 rounded-[12px] p-1.5 transition-colors md:p-2.5 md:hover:bg-hover">
      <button onClick={onPlay} className="relative block aspect-square w-full" aria-label={`Play ${track.title}`} disabled={!track.playable}>
        <Artwork src={track.cover} alt={track.title} className="size-full" rounded="lg" seed={track.album ?? track.title} />
        <span className={cn('absolute bottom-2 right-2 flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition-all', isCur ? 'opacity-100' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100')}>
          <Play className="ml-0.5 size-5 fill-current" />
        </span>
      </button>
      <div className="mt-3 min-w-0">
        <div className={cn('truncate text-[15px] font-semibold', isCur && 'text-accent')}>{track.title}</div>
        <div className="truncate text-[13px] text-fg-2">
          {track.artistId ? <Link href={`/artist/${track.artistId}`} className="hover:text-fg hover:underline">{track.artist}</Link> : track.artist}
        </div>
      </div>
    </div>
  );
}

function Onboarding({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[16px] border border-line bg-surface p-5 md:p-8">
      <div className="relative max-w-2xl">
        <h2 className="font-display text-2xl font-bold md:text-3xl">Let’s bring in your music</h2>
        <p className="mt-2 text-fg-2">Point Aurora at the folders where your songs live — on this computer or an external drive — or upload them from your phone. New songs show up on their own after that.</p>
      </div>
      <div className="relative mt-5 grid gap-2.5 md:grid-cols-3">
        {isAdmin && <OnboardCard href="/setup" icon={<Server />} title="Choose music folders" body="Pick folders on the computer or an external drive." primary />}
        <OnboardCard href="/setup?step=upload" icon={<Upload />} title="Upload from this device" body="Send songs from your phone or another computer." primary={!isAdmin} />
        <OnboardCard href="/sources?add=url" icon={<Link2 />} title="Connect a music server" body="Navidrome, Jellyfin, or a folder shared on your network." />
      </div>
    </div>
  );
}

function OnboardCard({ href, icon, title, body, primary }: { href: string; icon: ReactNode; title: string; body: string; primary?: boolean }) {
  return (
    <Link href={href} className={cn('group rounded-[18px] border p-5 transition hover:-translate-y-0.5', primary ? 'border-accent/50 bg-accent/10 hover:bg-accent/15' : 'border-line bg-surface hover:bg-surface-3')}>
      <div className={cn('mb-4 flex size-11 items-center justify-center rounded-xl [&_svg]:size-5', primary ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-fg')}>{icon}</div>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-sm text-fg-2">{body}</div>
    </Link>
  );
}
