'use client';

import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { fmtDuration, plural } from '@/lib/client/format';
import { useMe, useLike } from '@/lib/client/hooks';
import type { Track } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';

export default function LikedPage() {
  const me = useMe();
  const router = useRouter();
  const like = useLike();
  const { data, error, refetch } = useQuery({ queryKey: ['liked'], queryFn: () => api<Track[]>('/api/likes') });
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const liked = data?.filter((t) => t.liked);
  const total = liked?.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  return (
    <CollectionView
      art={
        <div className="flex aspect-square w-full items-center justify-center rounded-[14px] bg-accent">
          <Heart className="size-1/3 fill-[var(--accent-ink)] text-[var(--accent-ink)]" />
        </div>
      }
      color="#5b4bd6"
      eyebrow="Playlist"
      title="Liked Songs"
      meta={liked && <><span className="font-semibold text-fg">{me.name}</span><span>· {plural(liked.length, 'song')}{total ? `, ${fmtDuration(total)}` : ''}</span></>}
      rows={liked ? liked.map((t) => ({ key: t.id, track: t })) : null}
      context={{ type: 'liked', id: 'liked', title: 'Liked Songs', href: '/liked' }}
      onRemove={(keys) => void like(liked!.filter((t) => keys.includes(t.id)), false)}
      removeLabel="Remove from Liked Songs"
      empty={<EmptyState icon={<Heart />} title="Songs you like will appear here" body="Save songs by tapping the heart icon." action={<Button variant="primary" onClick={() => router.push('/search')}>Find songs</Button>} />}
    />
  );
}
