'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListPlus, ListEnd, Plus, Heart, HeartOff, Download, Trash2, Radio, User, Disc3, Link2, FolderPlus, ListMinus, ListMusic, CheckCircle2,
} from 'lucide-react';
import type { Track } from '@/lib/types';
import type { MenuItem } from '@/components/ui/menu';
import { usePlayer } from '@/stores/player';
import { useUI, toast } from '@/stores/ui';
import { useDownloads } from '@/stores/downloads';
import { useAddToPlaylist, useLike, usePlaylists } from '@/lib/client/hooks';
import { api } from '@/lib/client/api';

export interface TrackMenuOpts {
  onRemove?: () => void;
  removeLabel?: string;
}

export function useCollections() {
  return useQuery({ queryKey: ['collections'], queryFn: () => api<{ id: string; name: string; count: number }[]>('/api/collections'), staleTime: 30_000 });
}

export function useTrackMenu() {
  const router = useRouter();
  const qc = useQueryClient();
  const like = useLike();
  const addToPlaylist = useAddToPlaylist();
  const { data: playlists } = usePlaylists();
  const { data: collections } = useCollections();
  const saved = useDownloads((s) => s.saved);

  return (tracks: Track[], opts: TrackMenuOpts = {}): MenuItem[] => {
    const one = tracks.length === 1 ? tracks[0] : null;
    const allLiked = tracks.every((t) => t.liked);
    const allSaved = tracks.every((t) => saved.has(t.id));
    const editable = (playlists ?? []).filter((p) => p.canEdit);
    const items: MenuItem[] = [
      { label: 'Play next', icon: <ListPlus />, onSelect: () => usePlayer.getState().playNext(tracks) },
      { label: 'Add to queue', icon: <ListEnd />, onSelect: () => usePlayer.getState().addToQueue(tracks) },
      { separator: true, label: '' },
      {
        label: 'Add to playlist',
        icon: <Plus />,
        children: [
          { label: 'New playlist…', icon: <Plus />, onSelect: () => useUI.getState().openCreatePlaylist({ tracks }) },
          ...(editable.length ? [{ separator: true, label: '' } as MenuItem] : []),
          ...editable.slice(0, 40).map((p) => ({ label: p.name, icon: <ListMusic />, onSelect: () => void addToPlaylist(p, tracks) })),
          ...(editable.length > 40 ? [{ label: 'More playlists…', icon: <ListMusic />, onSelect: () => useUI.getState().openAddToPlaylist(tracks) }] : []),
        ],
      },
      { label: allLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: allLiked ? <HeartOff /> : <Heart />, onSelect: () => void like(tracks, !allLiked) },
      allSaved
        ? { label: 'Remove download', icon: <Trash2 />, onSelect: () => void useDownloads.getState().remove(tracks.map((t) => t.id)).then(() => toast.success('Removed from downloads')) }
        : { label: 'Download', icon: <Download />, onSelect: () => useDownloads.getState().enqueue(tracks), disabled: !tracks.some((t) => t.playable && !t.offline) },
      {
        label: 'Add to collection',
        icon: <FolderPlus />,
        children: [
          {
            label: 'New collection…',
            icon: <Plus />,
            onSelect: async () => {
              const name = window.prompt('Collection name');
              if (!name?.trim()) return;
              const { id } = await api<{ id: string }>('/api/collections', { body: { name } });
              await api(`/api/collections/${id}/items`, { body: { kind: 'track', refIds: tracks.map((t) => t.id) } });
              qc.invalidateQueries({ queryKey: ['collections'] });
              toast.success(`Added to “${name}”`);
            },
          },
          ...(collections ?? []).map((c) => ({
            label: c.name,
            icon: <CheckCircle2 />,
            onSelect: async () => {
              await api(`/api/collections/${c.id}/items`, { body: { kind: 'track', refIds: tracks.map((t) => t.id) } });
              qc.invalidateQueries({ queryKey: ['collections'] });
              qc.invalidateQueries({ queryKey: ['collection', c.id] });
              toast.success(`Added to “${c.name}”`);
            },
          })),
        ],
      },
    ];
    if (opts.onRemove) items.push({ label: opts.removeLabel ?? 'Remove from this playlist', icon: <ListMinus />, onSelect: opts.onRemove, danger: true });
    if (one) {
      items.push({ separator: true, label: '' });
      items.push({ label: 'Go to song radio', icon: <Radio />, onSelect: () => router.push(`/radio?track=${one.id}`) });
      if (one.artistId) items.push({ label: 'Go to artist', icon: <User />, onSelect: () => router.push(`/artist/${one.artistId}`) });
      if (one.albumId) items.push({ label: 'Go to album', icon: <Disc3 />, onSelect: () => router.push(`/album/${one.albumId}`) });
      items.push({
        label: 'Copy link',
        icon: <Link2 />,
        onSelect: () => {
          const url = new URL(one.albumId ? `/album/${one.albumId}?track=${one.id}` : `/radio?track=${one.id}`, location.href).toString();
          void navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'), () => toast.error('Couldn’t copy link'));
        },
      });
    }
    return items;
  };
}
