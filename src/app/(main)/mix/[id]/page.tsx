'use client';

import { use } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Save, RefreshCw, ListEnd } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { fmtDuration, plural } from '@/lib/client/format';
import type { Mix, Playlist } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { MixArt } from '@/components/media/cards';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { usePlayer } from '@/stores/player';
import { toast } from '@/stores/ui';

export default function MixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['mix', id], queryFn: () => api<Mix>(`/api/mixes/${id}`), staleTime: 5 * 60_000 });
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const total = data?.tracks.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  const saveAs = async () => {
    if (!data) return;
    const pl = await api<Playlist>('/api/playlists', { body: { name: `${data.title} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, description: data.subtitle, trackIds: data.tracks.map((t) => t.id) } });
    void qc.invalidateQueries({ queryKey: ['playlists'] });
    toast.success(`Saved as “${pl.name}”`);
    router.push(`/playlist/${pl.id}`);
  };
  return (
    <CollectionView
      art={data ? <MixArt covers={data.covers} color={data.color} title={data.title} className="aspect-square" /> : <div className="skeleton aspect-square rounded-[14px]" />}
      color={data?.color}
      eyebrow={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" /> Made for you</span>}
      title={data?.title ?? ' '}
      description={data?.subtitle}
      meta={data && <span>{plural(data.tracks.length, 'song')}{total ? `, ${fmtDuration(total)}` : ''}</span>}
      rows={data ? data.tracks.map((t, i) => ({ key: `${t.id}:${i}`, track: t })) : null}
      context={{ type: 'mix', id, title: data?.title ?? 'Mix', href: `/mix/${id}` }}
      menu={
        data
          ? [
              { label: 'Save as playlist', icon: <Save />, onSelect: () => void saveAs() },
              { label: 'Add to queue', icon: <ListEnd />, onSelect: () => usePlayer.getState().addToQueue(data.tracks) },
              { label: 'Refresh', icon: <RefreshCw />, onSelect: () => void refetch() },
            ]
          : undefined
      }
      empty={<EmptyState icon={<Sparkles />} title="Nothing here yet" body="Listen to more music and this mix will fill up." />}
    />
  );
}
