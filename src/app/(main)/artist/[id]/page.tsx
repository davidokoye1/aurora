'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Radio, ListEnd, Link2, BadgeCheck } from 'lucide-react';
import { api } from '@/lib/client/api';
import { plural } from '@/lib/client/format';
import { useToggleFollow } from '@/lib/client/hooks';
import type { Album, Artist, Track } from '@/lib/types';
import { PageHero, PlayFab, ShuffleButton, MediaCard, Shelf, CardGrid, useArtColor } from '@/components/media/cards';
import { TrackList, TrackListSkeleton } from '@/components/media/track-list';
import { Artwork } from '@/components/ui/artwork';
import { Button, IconButton } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { ErrorState, Chip } from '@/components/ui/misc';
import { MoreHorizontal } from 'lucide-react';
import { usePlayer } from '@/stores/player';
import { toast } from '@/stores/ui';
import { usePageTint } from '@/components/layout/app-shell';
import { MobileTop } from '@/components/layout/mobile-top';
import { loadAlbum, loadArtist } from '@/lib/client/loaders';

interface Data {
  artist: Artist;
  popular: Track[];
  albums: Album[];
  appearsOn: Album[];
  related: Artist[];
  all: Track[];
}

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const follow = useToggleFollow();
  const [more, setMore] = useState(false);
  const [disc, setDisc] = useState<'all' | 'albums' | 'singles'>('all');
  const { data, error, refetch } = useQuery({ queryKey: ['artist', id], queryFn: () => api<Data>(`/api/artists/${id}`) });
  const color = useArtColor(data?.artist.image);
  usePageTint(color);
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const a = data?.artist;
  const ctx = { type: 'artist' as const, id, title: a?.name ?? 'Artist', href: `/artist/${id}` };
  const albums = data?.albums.filter((al) => (disc === 'albums' ? al.trackCount >= 4 : disc === 'singles' ? al.trackCount < 4 : true)) ?? [];
  return (
    <div className="animate-fade-in">
      <MobileTop title={a?.name ?? ''} back overlay large={false} />
      <PageHero
        art={<Artwork src={a?.image} alt={a?.name ?? ''} className="aspect-square w-full" rounded="full" kind="artist" seed={a?.name} priority />}
        round
        color={color}
        eyebrow={<span className="inline-flex items-center gap-1.5"><BadgeCheck className="size-4 text-accent" /> Artist in your library</span>}
        title={a?.name ?? ' '}
        meta={a && <span>{plural(a.trackCount, 'song')} · {plural(a.albumCount, 'release')}{a.tags.length ? ` · ${a.tags.slice(0, 3).join(', ')}` : ''}</span>}
      />
      <div className="relative px-4 md:px-8">
        <div className="flex items-center gap-3 py-5">
          <PlayFab context={ctx} load={() => loadArtist(id)} size="lg" />
          <ShuffleButton onClick={() => data && usePlayer.getState().playTracks(data.all, { context: ctx, shuffle: true })} />
          {a && (
            <Button variant="outline" size="sm" onClick={() => void follow(id, !a.followed, a.name).then(() => refetch())}>
              {a.followed ? 'Following' : 'Follow'}
            </Button>
          )}
          <Menu
            align="start"
            items={[
              { label: 'Go to artist radio', icon: <Radio />, onSelect: () => router.push(`/radio?artist=${id}`) },
              { label: 'Add all to queue', icon: <ListEnd />, onSelect: () => data && usePlayer.getState().addToQueue(data.all) },
              { label: 'Copy link', icon: <Link2 />, onSelect: () => void navigator.clipboard?.writeText(location.href).then(() => toast.success('Link copied')) },
            ]}
            trigger={<span><IconButton label="More options" size="lg"><MoreHorizontal /></IconButton></span>}
          />
        </div>
        <section>
          <h2 className="mb-3 font-display text-[21px] font-extrabold md:text-2xl">Popular</h2>
          {data ? (
            <TrackList rows={(more ? data.popular : data.popular.slice(0, 5)).map((t) => ({ key: t.id, track: t }))} context={ctx} variant="compact" />
          ) : (
            <TrackListSkeleton rows={5} />
          )}
          {data && data.popular.length > 5 && (
            <button className="mt-2 px-4 text-sm font-semibold text-fg-2 hover:text-fg" onClick={() => setMore(!more)}>
              {more ? 'Show less' : 'See more'}
            </button>
          )}
        </section>
        {data && data.albums.length > 0 && (
          <section className="mt-12">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-[21px] font-extrabold md:text-2xl">Discography</h2>
              <div className="flex gap-2">
                <Chip active={disc === 'all'} onClick={() => setDisc('all')}>All</Chip>
                <Chip active={disc === 'albums'} onClick={() => setDisc('albums')}>Albums</Chip>
                <Chip active={disc === 'singles'} onClick={() => setDisc('singles')}>Singles & EPs</Chip>
              </div>
            </div>
            <CardGrid>
              {albums.map((al) => (
                <MediaCard key={al.id} href={`/album/${al.id}`} title={al.title} subtitle={[al.year, al.trackCount >= 4 ? 'Album' : al.trackCount > 1 ? 'EP' : 'Single'].filter(Boolean).join(' · ')} cover={al.cover} kind="album" context={{ type: 'album', id: al.id, title: al.title, href: `/album/${al.id}` }} load={() => loadAlbum(al.id)} />
              ))}
            </CardGrid>
          </section>
        )}
        {a?.bio && (
          <section className="mt-12 max-w-3xl rounded-[22px] bg-surface-2 p-6">
            <h2 className="mb-2 font-display text-[21px] font-extrabold md:text-2xl">About</h2>
            <p className="text-sm leading-relaxed text-fg-2">{a.bio}</p>
            <p className="mt-3 text-xs text-fg-3">From Wikipedia via MusicBrainz</p>
          </section>
        )}
        {data && data.appearsOn.length > 0 && (
          <div className="mt-12">
            <Shelf title="Appears on">
              {data.appearsOn.map((al) => (
                <MediaCard key={al.id} href={`/album/${al.id}`} title={al.title} subtitle={al.artist ?? ''} cover={al.cover} kind="album" context={{ type: 'album', id: al.id, title: al.title, href: `/album/${al.id}` }} load={() => loadAlbum(al.id)} />
              ))}
            </Shelf>
          </div>
        )}
        {data && data.related.length > 0 && (
          <div className="mt-12">
            <Shelf title="Fans also like" subtitle="Similar artists in your library">
              {data.related.map((r) => (
                <MediaCard key={r.id} href={`/artist/${r.id}`} title={r.name} subtitle="Artist" cover={r.image} kind="artist" context={{ type: 'artist', id: r.id, title: r.name, href: `/artist/${r.id}` }} load={() => loadArtist(r.id)} />
              ))}
            </Shelf>
          </div>
        )}
      </div>
    </div>
  );
}
