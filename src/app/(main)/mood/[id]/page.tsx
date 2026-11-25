'use client';

import { use } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, ListEnd } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { fmtDuration, plural } from '@/lib/client/format';
import type { Mix, Playlist } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { MixArt } from '@/components/media/cards';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { usePlayer } from '@/stores/player';
import { toast } from '@/stores/ui';

export default function MoodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['mood', id], queryFn: () => api<Mix & { gradient: [string, string] }>(`/api/mood/${id}`) });
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const total = data?.tracks.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  return (
    <CollectionView
      art={data ? <MixArt covers={data.covers} color={data.gradient[0]} title={data.title} className="aspect-square" /> : <div className="skeleton aspect-square rounded-[14px]" />}
      color={data?.gradient[0]}
      eyebrow="Mood"
      title={data?.title ?? ' '}
      description={data?.subtitle}
      meta={data && <span>{plural(data.tracks.length, 'song')} from your library{total ? `, ${fmtDuration(total)}` : ''}</span>}
      rows={data ? data.tracks.map((t) => ({ key: t.id, track: t })) : null}
      context={{ type: 'mood', id, title: data?.title ?? 'Mood', href: `/mood/${id}` }}
      menu={
        data
          ? [
              {
                label: 'Save as playlist',
                icon: <Save />,
                onSelect: async () => {
                  const pl = await api<Playlist>('/api/playlists', { body: { name: `${data.title} Mix`, description: data.subtitle, trackIds: data.tracks.map((t) => t.id) } });
                  void qc.invalidateQueries({ queryKey: ['playlists'] });
                  toast.success(`Saved as “${pl.name}”`);
                  router.push(`/playlist/${pl.id}`);
                },
              },
              { label: 'Add to queue', icon: <ListEnd />, onSelect: () => usePlayer.getState().addToQueue(data.tracks) },
            ]
          : undefined
      }
      empty={<EmptyState title="No matches in your library yet" body="Add more music — or music that fits this mood — and it will show up here." />}
    />
  );
}
