'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Info, X, Search, Plus } from 'lucide-react';
import { useUI } from '@/stores/ui';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/misc';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { api } from '@/lib/client/api';
import { usePlaylists, useAddToPlaylist } from '@/lib/client/hooks';
import type { Playlist } from '@/lib/types';
import { toast } from '@/stores/ui';
import { cn } from '@/components/ui/cn';
import { usePlayer } from '@/stores/player';

export function CreatePlaylistDialog() {
  const state = useUI((s) => s.createPlaylist);
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state) {
      setName(state.tracks?.length === 1 ? state.tracks[0].title : '');
      setDesc('');
    }
  }, [state]);
  const submit = async () => {
    setBusy(true);
    try {
      const pl = await api<Playlist>('/api/playlists', { body: { name: name.trim() || 'New Playlist', description: desc, trackIds: state?.tracks?.map((t) => t.id) ?? [] } });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      useUI.getState().closeDialogs();
      toast.success(`Created “${pl.name}”`);
      if (state?.onCreated) state.onCreated(pl.id);
      else if (!state?.tracks?.length) router.push(`/playlist/${pl.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && useUI.getState().closeDialogs()}
      title="Create playlist"
      description={state?.tracks?.length ? `With ${state.tracks.length === 1 ? `“${state.tracks[0].title}”` : `${state.tracks.length} songs`}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => useUI.getState().closeDialogs()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="pl-name">Name</Label>
          <Input id="pl-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My playlist" maxLength={120} />
        </div>
        <div>
          <Label htmlFor="pl-desc" hint="optional">Description</Label>
          <Textarea id="pl-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Give your playlist a vibe" maxLength={1000} />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function AddToPlaylistDialog() {
  const state = useUI((s) => s.addToPlaylist);
  const { data } = usePlaylists();
  const add = useAddToPlaylist();
  const [q, setQ] = useState('');
  const list = (data ?? []).filter((p) => p.canEdit && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && useUI.getState().closeDialogs()} title="Add to playlist" description={state ? `${state.tracks.length === 1 ? `“${state.tracks[0].title}”` : `${state.tracks.length} songs`}` : undefined}>
      <div className="relative mb-3">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a playlist" className="pl-10" autoFocus />
      </div>
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">
        <button onClick={() => useUI.setState({ addToPlaylist: null, createPlaylist: { tracks: state?.tracks } })} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-hover">
          <div className="flex size-12 items-center justify-center rounded-lg bg-surface-3">
            <Plus className="size-5" />
          </div>
          <span className="font-semibold">New playlist</span>
        </button>
        {list.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              if (state) void add(p, state.tracks);
              useUI.getState().closeDialogs();
            }}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-hover"
          >
            {p.cover ? <Artwork src={p.cover} alt="" className="size-12" /> : <Mosaic covers={p.covers} alt="" className="size-12" seed={p.name} />}
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.name}</div>
              <div className="text-xs text-fg-2">{p.trackCount} songs</div>
            </div>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function ConfirmDialog() {
  const c = useUI((s) => s.confirm);
  const close = (ok: boolean) => {
    c?.resolve(ok);
    useUI.setState({ confirm: null });
  };
  return (
    <Dialog
      open={!!c}
      onOpenChange={(o) => !o && close(false)}
      title={c?.title ?? ''}
      description={c?.body}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={c?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {c?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['→ / ←', 'Seek forward / back 5s'],
  ['Shift + → / ←', 'Next / previous track'],
  ['↑ / ↓', 'Volume up / down'],
  ['M', 'Mute'],
  ['S', 'Toggle shuffle'],
  ['R', 'Cycle repeat'],
  ['L', 'Like current song'],
  ['Q', 'Toggle queue'],
  ['Y', 'Toggle lyrics'],
  ['F', 'Full-screen player'],
  ['/', 'Search'],
  ['G then H / L / D / S', 'Go to Home / Library / Discover / Settings'],
  ['?', 'Show shortcuts'],
  ['Esc', 'Close player or dialog'],
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => useUI.getState().setShortcuts(o)} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-md border border-line-strong bg-surface-2 px-2 py-0.5 font-mono text-xs">{k}</kbd>
            </dt>
            <dd className="text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const playerOpen = usePlayer((s) => s.fullOpen);
  return (
    <div
      className={cn('pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-4', playerOpen ? 'top-[calc(env(safe-area-inset-top)+64px)]' : 'bottom-[calc(var(--toast-offset,0px)+12px)]')}
      aria-live="polite"
      role="status"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md animate-rise items-center gap-3 rounded-xl bg-fg px-4 py-3 text-sm font-medium text-bg shadow-float">
          {t.kind === 'success' ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : t.kind === 'error' ? <AlertTriangle className="size-4 shrink-0 text-danger" /> : <Info className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                useUI.getState().dismiss(t.id);
              }}
              className="shrink-0 font-bold underline-offset-2 hover:underline"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => useUI.getState().dismiss(t.id)} className={cn('shrink-0 rounded-full p-0.5 opacity-60 hover:opacity-100')} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
