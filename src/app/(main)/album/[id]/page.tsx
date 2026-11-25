'use client';

import Link from 'next/link';
import { use, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Heart, HeartOff, Radio, User, ListPlus, ListEnd, Plus, Link2, FolderPlus } from 'lucide-react';
import { api } from '@/lib/client/api';
import { fmtDuration, plural } from '@/lib/client/format';
import { useToggleSaveAlbum } from '@/lib/client/hooks';
import type { Album, Track } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { Artwork } from '@/components/ui/artwork';
import { IconButton } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/misc';
import { MediaCard, Shelf } from '@/components/media/cards';
import { loadAlbum } from '@/lib/client/loaders';
import { usePlayer } from '@/stores/player';
import { useUI, toast } from '@/stores/ui';
import { useRouter } from 'next/navigation';

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sp = useSearchParams();
  const save = useToggleSaveAlbum();
  const { data, error, refetch } = useQuery({ queryKey: ['album', id], queryFn: () => api<{ album: Album; tracks: Track[]; more: Album[] }>(`/api/albums/${id}`) });
  const highlight = sp.get('track');
  useEffect(() => {
    if (!highlight || !data) return;
    const t = setTimeout(() => {
      const idx = data.tracks.findIndex((x) => x.id === highlight);
      document.querySelectorAll('[role="row"]')[idx + 1]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 300);
    return () => clearTimeout(t);
  }, [highlight, data]);
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const a = data?.album;
  const total = data?.tracks.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  const discs = new Set(data?.tracks.map((t) => t.discNo ?? 1)).size;
  const rows = data?.tracks.map((t) => ({ key: t.id, track: t, meta: discs > 1 && t.trackNo === 1 ? <span className="text-fg-3"> · Disc {t.discNo}</span> : undefined })) ?? null;
  return (
    <CollectionView
      art={<Artwork src={a?.cover} alt={a?.title ?? ''} className="aspect-square w-full" rounded="lg" kind="album" seed={a?.title} priority />}
      coverForColor={a?.cover}
      eyebrow="Album"
      title={a?.title ?? ' '}
      meta={
        a && (
          <>
            {a.artistId ? <Link href={`/artist/${a.artistId}`} className="font-semibold text-fg hover:underline">{a.artist}</Link> : <span className="font-semibold">{a.artist}</span>}
            {a.year && <span>· {a.year}</span>}
            <span>· {plural(data!.tracks.length, 'song')}{total ? `, ${fmtDuration(total)}` : ''}</span>
          </>
        )
      }
      rows={rows}
      variant="album"
      filterable={false}
      context={{ type: 'album', id, title: a?.title ?? 'Album', href: `/album/${id}` }}
      extraActions={
        a && (
          <IconButton label={a.saved ? 'Remove from Your Library' : 'Save to Your Library'} size="lg" active={a.saved} onClick={() => void save(id, !a.saved)}>
            <Heart className={a.saved ? 'fill-current text-accent' : ''} />
          </IconButton>
        )
      }
      menu={
        data
          ? [
              { label: 'Add to queue', icon: <ListEnd />, onSelect: () => usePlayer.getState().addToQueue(data.tracks) },
              { label: 'Play next', icon: <ListPlus />, onSelect: () => usePlayer.getState().playNext(data.tracks) },
              { label: 'Add to playlist', icon: <Plus />, onSelect: () => useUI.getState().openAddToPlaylist(data.tracks) },
              { label: a?.saved ? 'Remove from Your Library' : 'Save to Your Library', icon: a?.saved ? <HeartOff /> : <Heart />, onSelect: () => void save(id, !a?.saved) },
              { label: 'Add to collection', icon: <FolderPlus />, onSelect: () => router.push(`/library?tab=collections&add=album:${id}`) },
              ...(a?.artistId ? [{ label: 'Go to artist radio', icon: <Radio />, onSelect: () => router.push(`/radio?artist=${a.artistId}`) }, { label: 'Go to artist', icon: <User />, onSelect: () => router.push(`/artist/${a.artistId}`) }] : []),
              { label: 'Copy link', icon: <Link2 />, onSelect: () => void navigator.clipboard?.writeText(location.href).then(() => toast.success('Link copied')) },
            ]
          : undefined
      }
    >
      {data && data.more.length > 0 && (
        <div className="mt-12">
          <Shelf title={`More by ${a?.artist}`} href={a?.artistId ? `/artist/${a.artistId}` : undefined}>
            {data.more.map((m) => (
              <MediaCard key={m.id} href={`/album/${m.id}`} title={m.title} subtitle={m.year ? String(m.year) : 'Album'} cover={m.cover} kind="album" context={{ type: 'album', id: m.id, title: m.title, href: `/album/${m.id}` }} load={() => loadAlbum(m.id)} />
            ))}
          </Shelf>
        </div>
      )}
      {data?.tracks.some((t) => !t.playable) && <p className="mt-6 text-xs text-fg-3">Greyed-out songs aren’t playable right now (their source is paused, offline, or in a format your browser can’t decode).</p>}
    </CollectionView>
  );
}
