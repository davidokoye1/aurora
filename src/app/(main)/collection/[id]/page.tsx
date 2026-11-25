'use client';

import { use } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder } from 'lucide-react';
import { api } from '@/lib/client/api';
import type { Album, Artist, Playlist, Track } from '@/lib/types';
import { Page } from '@/components/layout/page';
import { TrackList } from '@/components/media/track-list';
import { MediaCard, CardGrid, PlayFab } from '@/components/media/cards';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { loadAlbum, loadArtist, loadPlaylist } from '@/lib/client/loaders';

interface Data {
  collection: { id: string; name: string };
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['collection', id], queryFn: () => api<Data>(`/api/collections/${id}`) });
  if (error) return <Page><ErrorState error={error} retry={() => refetch()} /></Page>;
  const empty = data && !data.tracks.length && !data.albums.length && !data.artists.length && !data.playlists.length;
  const ctx = { type: 'collection' as const, id, title: data?.collection.name ?? 'Collection', href: `/collection/${id}` };
  return (
    <Page title={data?.collection.name ?? 'Collection'} subtitle="Collection" back actions={data && data.tracks.length > 0 && <PlayFab context={ctx} load={() => data.tracks} />}>
      {empty && <EmptyState title="This collection is empty" body="Use “Add to collection” from any song, album or playlist menu." />}
      <div className="space-y-10">
        {data && data.tracks.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl font-bold">Songs</h2>
            <TrackList
              rows={data.tracks.map((t) => ({ key: t.id, track: t }))}
              context={ctx}
              variant="search"
              removeLabel="Remove from collection"
              onRemove={async (keys) => {
                await api(`/api/collections/${id}/items`, { method: 'DELETE', body: { kind: 'track', refIds: keys } });
                void qc.invalidateQueries({ queryKey: ['collection', id] });
              }}
            />
          </section>
        )}
        {data && data.albums.length > 0 && (
          <section>
            <h2 className="mb-3 px-2.5 font-display text-2xl font-bold">Albums</h2>
            <CardGrid>{data.albums.map((a) => <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={a.artist ?? ''} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />)}</CardGrid>
          </section>
        )}
        {data && data.artists.length > 0 && (
          <section>
            <h2 className="mb-3 px-2.5 font-display text-2xl font-bold">Artists</h2>
            <CardGrid>{data.artists.map((a) => <MediaCard key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle="Artist" cover={a.image} kind="artist" context={{ type: 'artist', id: a.id, title: a.name, href: `/artist/${a.id}` }} load={() => loadArtist(a.id)} />)}</CardGrid>
          </section>
        )}
        {data && data.playlists.length > 0 && (
          <section>
            <h2 className="mb-3 px-2.5 font-display text-2xl font-bold">Playlists</h2>
            <CardGrid>{data.playlists.map((p) => <MediaCard key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={`By ${p.ownerName}`} cover={p.cover} covers={p.covers} kind="playlist" context={{ type: 'playlist', id: p.id, title: p.name, href: `/playlist/${p.id}` }} load={() => loadPlaylist(p.id)} />)}</CardGrid>
          </section>
        )}
      </div>
    </Page>
  );
}
