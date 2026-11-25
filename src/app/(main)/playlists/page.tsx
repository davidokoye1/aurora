'use client';

import Link from 'next/link';
import { Heart, Plus, Users, Sparkles } from 'lucide-react';
import { usePlaylists } from '@/lib/client/hooks';
import { Page } from '@/components/layout/page';
import { MediaCard, CardGrid, CardSkeletons } from '@/components/media/cards';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { useUI } from '@/stores/ui';
import { loadPlaylist } from '@/lib/client/loaders';
import { plural } from '@/lib/client/format';

export default function PlaylistsPage() {
  const { data, isLoading, error, refetch } = usePlaylists();
  const mine = data?.filter((p) => p.isOwner && !p.collaborative) ?? [];
  const collab = data?.filter((p) => p.collaborative || !p.isOwner) ?? [];
  return (
    <Page
      title="Playlists"
      back
      subtitle={data ? plural(data.length, 'playlist') : undefined}
      actions={
        <>
          <Link href="/discover" className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-3 px-5 text-sm font-semibold hover:bg-active"><Sparkles className="size-4" /> Generate a mix</Link>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => useUI.getState().openCreatePlaylist()}>
            New playlist
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : isLoading ? (
        <CardGrid><CardSkeletons n={10} /></CardGrid>
      ) : (
        <div className="space-y-10">
          <CardGrid>
            <Link href="/liked" className="press group col-span-2 flex min-h-[180px] flex-col justify-end rounded-[12px] bg-accent p-5 text-accent-ink transition hover:brightness-105">
              <Heart className="mb-auto size-8 fill-current" />
              <div className="font-display text-3xl font-extrabold">Liked Songs</div>
            </Link>
            {mine.map((p) => (
              <MediaCard key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={plural(p.trackCount, 'song')} cover={p.cover} covers={p.covers} kind="playlist" context={{ type: 'playlist', id: p.id, title: p.name, href: `/playlist/${p.id}` }} load={() => loadPlaylist(p.id)} />
            ))}
          </CardGrid>
          {collab.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 px-2.5 font-display text-2xl font-bold"><Users className="size-5" /> Shared with you & collaborative</h2>
              <CardGrid>
                {collab.map((p) => (
                  <MediaCard key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={`By ${p.ownerName}`} cover={p.cover} covers={p.covers} kind="playlist" context={{ type: 'playlist', id: p.id, title: p.name, href: `/playlist/${p.id}` }} load={() => loadPlaylist(p.id)} />
                ))}
              </CardGrid>
            </section>
          )}
          {!data?.length && <EmptyState title="Make your first playlist" body="Collect songs for any moment. Add tracks from any song’s ⋯ menu." action={<Button variant="primary" onClick={() => useUI.getState().openCreatePlaylist()}>Create playlist</Button>} />}
        </div>
      )}
    </Page>
  );
}
