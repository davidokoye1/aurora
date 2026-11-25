'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import { plural } from '@/lib/client/format';
import type { Album, Artist, Track } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { MediaCard, MixArt, Shelf } from '@/components/media/cards';
import { ErrorState } from '@/components/ui/misc';
import { loadAlbum, loadArtist } from '@/lib/client/loaders';

export default function GenrePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, refetch } = useQuery({ queryKey: ['genre', id], queryFn: () => api<{ genre: { id: string; label: string; color: string }; tracks: Track[]; albums: Album[]; artists: Artist[] }>(`/api/genre/${id}`) });
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const covers = [...new Set(data?.tracks.map((t) => t.cover).filter(Boolean))].slice(0, 4) as string[];
  return (
    <CollectionView
      art={data ? <MixArt covers={covers} color={data.genre.color} title={data.genre.label} className="aspect-square" /> : <div className="skeleton aspect-square rounded-[14px]" />}
      color={data?.genre.color}
      eyebrow="Genre"
      title={data?.genre.label ?? ' '}
      meta={data && <span>{plural(data.tracks.length, 'song')} · {plural(data.artists.length, 'artist')} in your library</span>}
      rows={data ? data.tracks.slice(0, 100).map((t) => ({ key: t.id, track: t })) : null}
      context={{ type: 'genre', id, title: data?.genre.label ?? 'Genre', href: `/genre/${id}` }}
    >
      {data && data.artists.length > 0 && (
        <div className="mt-12">
          <Shelf title="Artists">
            {data.artists.map((a) => (
              <MediaCard key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle="Artist" cover={a.image} kind="artist" context={{ type: 'artist', id: a.id, title: a.name, href: `/artist/${a.id}` }} load={() => loadArtist(a.id)} />
            ))}
          </Shelf>
        </div>
      )}
      {data && data.albums.length > 0 && (
        <div className="mt-10">
          <Shelf title="Albums">
            {data.albums.map((a) => (
              <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={a.artist ?? ''} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />
            ))}
          </Shelf>
        </div>
      )}
    </CollectionView>
  );
}
