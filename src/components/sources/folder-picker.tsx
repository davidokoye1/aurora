'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft, Folder, FolderOpen, HardDrive, Usb, Music, Download, Monitor, Home, Cloud, Check, Loader2 } from 'lucide-react';
import { api } from '@/lib/client/api';
import { toast } from '@/stores/ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/components/ui/cn';

interface Place {
  name: string;
  path: string;
  kind: 'music' | 'downloads' | 'desktop' | 'home' | 'cloud' | 'drive' | 'removable';
}
interface Listing {
  path: string;
  parent: string | null;
  crumbs: { name: string; path: string }[];
  dirs: { name: string; path: string }[];
  audioHere: number;
  audioBelow: number;
  capped: boolean;
}

const PLACE_ICON: Record<Place['kind'], React.ReactNode> = {
  music: <Music />, downloads: <Download />, desktop: <Monitor />, home: <Home />, cloud: <Cloud />, drive: <HardDrive />, removable: <Usb />,
};

const baseName = (p: string) => p.split(/[\\/]+/).filter(Boolean).pop() || p;

/** Browse folders on the computer running Aurora and add one to the library — no typing paths. */
export function FolderPicker({ onAdded, compact }: { onAdded?: (path: string) => void; compact?: boolean }) {
  const qc = useQueryClient();
  const [cur, setCur] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const home = useQuery({ queryKey: ['fs', 'places'], queryFn: () => api<{ places: Place[] }>('/api/fs'), staleTime: 15_000 });
  const dir = useQuery({ queryKey: ['fs', cur], queryFn: () => api<Listing>(`/api/fs?path=${encodeURIComponent(cur!)}`), enabled: !!cur, retry: false });

  const add = async (p: string) => {
    setAdding(true);
    try {
      await api('/api/sources', { body: { type: 'folder', name: baseName(p), config: { path: p } } });
      toast.success(`Adding “${baseName(p)}” — songs appear as they’re found`);
      void qc.invalidateQueries({ queryKey: ['sources'] });
      onAdded?.(p);
      setCur(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const rowCls = 'press flex min-h-[52px] w-full items-center gap-3 rounded-[12px] px-3 text-left transition-colors hover:bg-hover';

  if (!cur) {
    const places = home.data?.places ?? [];
    const groups: [string, Place[]][] = [
      ['Your folders', places.filter((p) => ['music', 'downloads', 'desktop', 'home', 'cloud'].includes(p.kind))],
      ['Drives', places.filter((p) => p.kind === 'drive' || p.kind === 'removable')],
    ];
    return (
      <div className={cn('space-y-5', compact && 'space-y-3')} data-testid="folder-picker">
        {home.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] rounded-[12px]" />)}</div>}
        {home.error && <p className="text-sm text-danger">{(home.error as Error).message}</p>}
        {groups.map(([label, list]) =>
          list.length ? (
            <section key={label}>
              <h3 className="mb-1 px-3 text-[12px] font-bold uppercase tracking-[0.12em] text-fg-3">{label}</h3>
              <ul>
                {list.map((p) => (
                  <li key={p.path}>
                    <button className={rowCls} onClick={() => setCur(p.path)}>
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-accent [&_svg]:size-[18px]">{PLACE_ICON[p.kind]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                        <span className="block truncate text-[12.5px] text-fg-3">{p.path}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-fg-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        <p className="px-3 text-[12.5px] text-fg-3">Plug in an external drive and it shows up here. Choose the folder that holds your music — sub-folders are included.</p>
      </div>
    );
  }

  const d = dir.data;
  const count = d ? d.audioBelow : 0;
  return (
    <div className="space-y-3" data-testid="folder-picker">
      <div className="flex items-center gap-1">
        <button aria-label="Back" className="press flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-hover" onClick={() => setCur(d?.parent ?? null)}>
          <ChevronLeft className="size-5" />
        </button>
        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[13px] text-fg-2" aria-label="Folder path">
          <button className="shrink-0 rounded px-1.5 py-1 hover:text-fg" onClick={() => setCur(null)}>Places</button>
          {(d?.crumbs ?? []).map((c) => (
            <span key={c.path} className="flex shrink-0 items-center gap-0.5">
              <ChevronRight className="size-3 text-fg-3" />
              <button className="max-w-[140px] truncate rounded px-1.5 py-1 hover:text-fg" onClick={() => setCur(c.path)}>{c.name}</button>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-surface-2 p-3.5">
        <FolderOpen className="size-6 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{baseName(cur)}</div>
          <div className="text-[13px] text-fg-2" data-testid="audio-count">
            {dir.isLoading ? 'Counting songs…' : dir.error ? (dir.error as Error).message : count ? `${count.toLocaleString()}${d!.capped ? '+' : ''} songs in here` : 'No songs in here yet'}
          </div>
        </div>
        <Button onClick={() => void add(cur)} disabled={adding || !!dir.error} icon={adding ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}>
          Use this folder
        </Button>
      </div>

      {dir.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-[12px]" />)}</div>
      ) : d && d.dirs.length ? (
        <ul className="max-h-[52vh] overflow-y-auto">
          {d.dirs.map((x) => (
            <li key={x.path}>
              <button className={cn(rowCls, 'min-h-11')} onClick={() => setCur(x.path)}>
                <Folder className="size-5 shrink-0 text-fg-2" />
                <span className="min-w-0 flex-1 truncate text-[15px]">{x.name}</span>
                <ChevronRight className="size-4 shrink-0 text-fg-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : d ? (
        <p className="px-3 text-sm text-fg-3">No sub-folders.</p>
      ) : null}
    </div>
  );
}
