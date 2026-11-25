'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Radio, Save, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client/api';
import type { Playlist, Track } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { ErrorState, EmptyState } from '@/components/ui/misc';
import { Artwork } from '@/components/ui/artwork';
import { toast } from '@/stores/ui';

function RadioInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const track = sp.get('track') ?? undefined;
  const artist = sp.get('artist') ?? undefined;
  const q = new URLSearchParams();
  if (track) q.set('track', track);
  if (artist) q.set('artist', artist);
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ['radio', track, artist], queryFn: () => api<{ title: string; tracks: Track[] }>(`/api/recs/radio?${q}`), enabled: !!(track || artist) });
  const seed = useQuery({ queryKey: ['radio-seed', track], queryFn: () => api<{ track: Track }>(`/api/tracks/${track}`), enabled: !!track });
  if (!track && !artist) return <div className="pt-24"><EmptyState icon={<Radio />} title="Start a radio station" body="Open the ⋯ menu on any song or artist and choose “Go to radio”." /></div>;
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const tracks = data ? [...(seed.data ? [seed.data.track] : []), ...data.tracks] : null;
  const cover = seed.data?.track.cover ?? data?.tracks[0]?.cover;
  return (
    <CollectionView
      art={
        <div className="relative aspect-square">
          <Artwork src={cover} alt="" className="size-full" rounded={artist ? 'full' : 'lg'} />
          <div className="absolute inset-0 flex items-end justify-start rounded-[14px] bg-gradient-to-t from-black/70 to-transparent p-4">
            <span className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white backdrop-blur"><Radio className="size-3.5" /> Radio</span>
          </div>
        </div>
      }
      coverForColor={cover}
      eyebrow="Radio"
      title={data?.title ?? 'Radio'}
      description="An endless station of songs from your library that sound like this. Refresh for a new spin."
      rows={tracks ? tracks.map((t, i) => ({ key: `${t.id}:${i}`, track: t })) : null}
      context={{ type: 'radio', id: track ?? artist, title: data?.title ?? 'Radio', href: `/radio?${q}` }}
      menu={[
        { label: 'Refresh station', icon: <RefreshCw />, onSelect: () => void refetch(), disabled: isFetching },
        {
          label: 'Save as playlist',
          icon: <Save />,
          onSelect: async () => {
            if (!tracks) return;
            const pl = await api<Playlist>('/api/playlists', { body: { name: data?.title ?? 'Radio', trackIds: tracks.map((t) => t.id) } });
            void qc.invalidateQueries({ queryKey: ['playlists'] });
            toast.success(`Saved as “${pl.name}”`);
            router.push(`/playlist/${pl.id}`);
          },
        },
      ]}
      empty={<EmptyState title="Not enough similar music yet" body="Add more music to your library to build a station." />}
    />
  );
}

export default function RadioPage() {
  return (
    <Suspense>
      <RadioInner />
    </Suspense>
  );
}
