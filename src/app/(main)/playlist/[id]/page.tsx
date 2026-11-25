'use client';

import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Share2, Users, ImagePlus, ListEnd, Plus, Lock, Link2, LogOut, Sparkles, Music4 } from 'lucide-react';
import { api } from '@/lib/client/api';
import { fmtDuration, plural } from '@/lib/client/format';
import type { Playlist, Track } from '@/lib/types';
import { CollectionView } from '@/components/media/collection-view';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Input, Label, Textarea, Switch } from '@/components/ui/misc';
import { usePlayer } from '@/stores/player';
import { toast, confirmDialog, useUI } from '@/stores/ui';
import { TrackList } from '@/components/media/track-list';

interface Data {
  playlist: Playlist;
  collaborators: { id: string; name: string }[];
  entries: { entryId: string; addedAt: number; addedBy: string | null; track: Track }[];
}

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const router = useRouter();
  const { data, error, refetch } = useQuery({ queryKey: ['playlist', id], queryFn: () => api<Data>(`/api/playlists/${id}`) });
  const [edit, setEdit] = useState(false);
  const [share, setShare] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (error) return <div className="pt-20"><ErrorState error={error} retry={() => refetch()} /></div>;
  const p = data?.playlist;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['playlist', id] });
    void qc.invalidateQueries({ queryKey: ['playlists'] });
  };
  const remove = async (keys: string[]) => {
    const removed = data!.entries.filter((e) => keys.includes(e.entryId));
    qc.setQueryData<Data>(['playlist', id], (d) => d && { ...d, entries: d.entries.filter((e) => !keys.includes(e.entryId)) });
    try {
      await api(`/api/playlists/${id}/tracks`, { method: 'DELETE', body: { entryIds: keys } });
      toast.success(keys.length === 1 ? `Removed “${removed[0]?.track.title}”` : `Removed ${keys.length} songs`, {
        label: 'Undo',
        run: () => void api(`/api/playlists/${id}/tracks`, { body: { trackIds: removed.map((r) => r.track.id) } }).then(refresh),
      });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    }
  };
  const reorder = async (keys: string[]) => {
    qc.setQueryData<Data>(['playlist', id], (d) => d && { ...d, entries: keys.map((k) => d.entries.find((e) => e.entryId === k)!).filter(Boolean) });
    try {
      await api(`/api/playlists/${id}/order`, { method: 'PUT', body: { entryIds: keys } });
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    }
  };
  const uploadCover = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    try {
      await api(`/api/playlists/${id}/cover`, { form: fd });
      toast.success('Cover updated');
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const total = data?.entries.reduce((s, e) => s + (e.track.duration ?? 0), 0) ?? 0;
  const art = p ? (
    <button className="group relative block aspect-square w-full" onClick={() => p.canEdit && setEdit(true)} disabled={!p.canEdit} aria-label="Edit playlist details">
      {p.cover ? <Artwork src={p.cover} alt={p.name} className="size-full" rounded="lg" kind="playlist" priority /> : <Mosaic covers={p.covers} alt={p.name} className="size-full" rounded="lg" seed={p.name} />}
      {p.canEdit && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[14px] bg-black/55 text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">
          <Pencil className="size-8" /> Edit details
        </span>
      )}
    </button>
  ) : (
    <div className="skeleton aspect-square w-full rounded-[14px]" />
  );
  return (
    <>
      <CollectionView
        art={art}
        coverForColor={p?.cover ?? p?.covers[0]}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            {p?.collaborative && <Users className="size-3.5" />}
            {p?.collaborative ? 'Collaborative playlist' : 'Playlist'}
          </span>
        }
        title={p?.name ?? ' '}
        description={p?.description}
        meta={
          p && (
            <>
              <span className="font-semibold text-fg">{p.ownerName}</span>
              {data!.collaborators.length > 0 && <span>· with {data!.collaborators.map((c) => c.name).join(', ')}</span>}
              <span>· {plural(p.trackCount, 'song')}{total ? `, ${fmtDuration(total)}` : ''}</span>
            </>
          )
        }
        rows={data ? data.entries.map((e) => ({ key: e.entryId, track: e.track, addedAt: e.addedAt, addedBy: p?.collaborative ? e.addedBy : null })) : null}
        context={{ type: 'playlist', id, title: p?.name ?? 'Playlist', href: `/playlist/${id}` }}
        showAdded
        onRemove={p?.canEdit ? remove : undefined}
        onReorder={p?.canEdit ? reorder : undefined}
        menu={
          p
            ? [
                ...(p.canEdit ? [{ label: 'Edit details', icon: <Pencil />, onSelect: () => setEdit(true) }, { label: 'Change cover image', icon: <ImagePlus />, onSelect: () => file.current?.click() }] : []),
                { label: 'Add to queue', icon: <ListEnd />, onSelect: () => usePlayer.getState().addToQueue(data!.entries.map((e) => e.track)) },
                { label: 'Share & invite', icon: <Share2 />, onSelect: () => setShare(true) },
                { label: 'Duplicate playlist', icon: <Plus />, onSelect: () => useUI.getState().openCreatePlaylist({ tracks: data!.entries.map((e) => e.track), onCreated: (nid) => router.push(`/playlist/${nid}`) }) },
                { separator: true, label: '' },
                p.isOwner
                  ? {
                      label: 'Delete playlist',
                      icon: <Trash2 />,
                      danger: true,
                      onSelect: async () => {
                        if (!(await confirmDialog({ title: `Delete “${p.name}”?`, body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return;
                        await api(`/api/playlists/${id}`, { method: 'DELETE' });
                        void qc.invalidateQueries({ queryKey: ['playlists'] });
                        toast.success('Playlist deleted');
                        router.push('/playlists');
                      },
                    }
                  : {
                      label: 'Leave playlist',
                      icon: <LogOut />,
                      danger: true,
                      onSelect: async () => {
                        await api(`/api/playlists/${id}`, { method: 'DELETE' });
                        void qc.invalidateQueries({ queryKey: ['playlists'] });
                        router.push('/playlists');
                      },
                    },
              ]
            : undefined
        }
        empty={
          <EmptyState
            icon={<Music4 />}
            title="Let’s find something for your playlist"
            body="Search for songs, or add from any album, mix or the queue using the ⋯ menu."
            action={
              <>
                <Button variant="primary" onClick={() => router.push('/search')}>Search songs</Button>
                <Button onClick={() => router.push('/discover')} icon={<Sparkles className="size-4" />}>Generate with AI mix</Button>
              </>
            }
          />
        }
      >
        {p?.canEdit && data && data.entries.length > 0 && <Recommended playlistId={id} existing={data.entries.map((e) => e.track.id)} onAdd={refresh} />}
      </CollectionView>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadCover(e.target.files[0])} />
      {p && edit && <EditDialog playlist={p} onClose={() => setEdit(false)} onSaved={refresh} onPickCover={() => file.current?.click()} />}
      {p && share && <ShareDialog playlist={p} onClose={() => setShare(false)} onChanged={refresh} />}
    </>
  );
}

function EditDialog({ playlist, onClose, onSaved, onPickCover }: { playlist: Playlist; onClose: () => void; onSaved: () => void; onPickCover: () => void }) {
  const [name, setName] = useState(playlist.name);
  const [desc, setDesc] = useState(playlist.description);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/playlists/${playlist.id}`, { method: 'PATCH', body: { name, description: desc } });
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Edit details" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div className="space-y-2">
          <button onClick={onPickCover} className="group relative block aspect-square w-full" aria-label="Choose cover image">
            {playlist.cover ? <Artwork src={playlist.cover} alt="" className="size-full" rounded="lg" /> : <Mosaic covers={playlist.covers} alt="" className="size-full" rounded="lg" seed={playlist.name} />}
            <span className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-black/50 text-white opacity-0 transition group-hover:opacity-100"><ImagePlus className="size-7" /></span>
          </button>
          {playlist.cover && (
            <button
              className="w-full text-center text-xs font-semibold text-fg-2 hover:text-fg hover:underline"
              onClick={async () => {
                await api(`/api/playlists/${playlist.id}`, { method: 'PATCH', body: { cover: null } });
                onSaved();
              }}
            >
              Remove photo
            </button>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="e-name">Name</Label>
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label htmlFor="e-desc">Description</Label>
            <Textarea id="e-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} placeholder="Add an optional description" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ShareDialog({ playlist, onClose, onChanged }: { playlist: Playlist; onClose: () => void; onChanged: () => void }) {
  const [links, setLinks] = useState<{ view?: string; collab?: string }>({});
  const make = async (kind: 'view' | 'collab') => {
    try {
      const r = await api<{ token: string }>(`/api/playlists/${playlist.id}/share`, { body: { kind } });
      const url = `${location.origin}/share/${r.token}`;
      setLinks((l) => ({ ...l, [kind]: url }));
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success('Link copied to clipboard');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Share playlist" description="Anyone with an account on this Aurora server can open these links.">
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-semibold"><Link2 className="size-4" /> View link</div>
              <div className="text-xs text-fg-2">Lets people see and play this playlist.</div>
            </div>
            <Button size="sm" onClick={() => make('view')}>{links.view ? 'Copy again' : 'Create link'}</Button>
          </div>
          {links.view && <Input readOnly value={links.view} className="mt-3 h-9 font-mono text-xs" onFocus={(e) => e.target.select()} />}
        </div>
        {playlist.isOwner && (
          <div className="rounded-xl bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-semibold"><Users className="size-4" /> Invite collaborators</div>
                <div className="text-xs text-fg-2">People who open this link can add, remove and reorder songs.</div>
              </div>
              <Button size="sm" variant="primary" onClick={() => make('collab')}>{links.collab ? 'Copy again' : 'Create invite'}</Button>
            </div>
            {links.collab && <Input readOnly value={links.collab} className="mt-3 h-9 font-mono text-xs" onFocus={(e) => e.target.select()} />}
            <label className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
              <span className="flex items-center gap-2"><Lock className="size-4" /> Collaborative</span>
              <Switch
                checked={playlist.collaborative}
                onChange={async (v) => {
                  await api(`/api/playlists/${playlist.id}`, { method: 'PATCH', body: { collaborative: v } });
                  onChanged();
                }}
                label="Collaborative"
              />
            </label>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Recommended({ playlistId, existing, onAdd }: { playlistId: string; existing: string[]; onAdd: () => void }) {
  const seed = existing.slice(-8);
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['pl-recs', playlistId, seed.join(',')],
    queryFn: () => api<Track[]>('/api/recs/autoplay', { body: { recent: existing.slice(-200), count: 10 } }),
    staleTime: 5 * 60_000,
  });
  const rows = (data ?? []).filter((t) => !existing.includes(t.id)).map((t) => ({ key: t.id, track: t }));
  if (!rows.length) return null;
  return (
    <section className="mt-12">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Recommended</h2>
          <p className="text-sm text-fg-2">Based on what’s in this playlist</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} loading={isFetching}>Refresh</Button>
      </div>
      <TrackList rows={rows} context={{ type: 'playlist', id: playlistId, title: 'Recommended', href: `/playlist/${playlistId}` }} variant="playlist" showHeader={false} />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          icon={<Plus className="size-4" />}
          onClick={async () => {
            await api(`/api/playlists/${playlistId}/tracks`, { body: { trackIds: rows.map((r) => r.track.id), skipDuplicates: true } });
            toast.success(`Added ${rows.length} songs`);
            onAdd();
          }}
        >
          Add all
        </Button>
      </div>
    </section>
  );
}
