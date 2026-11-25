'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Download, CheckCircle2, MoreHorizontal, Search, X, ArrowDownUp } from 'lucide-react';
import type { Track } from '@/lib/types';
import type { PlayContext } from '@/stores/player';
import { usePlayer } from '@/stores/player';
import { useDownloads } from '@/stores/downloads';
import { PageHero, PlayFab, ShuffleButton, useArtColor } from './cards';
import { TrackList, TrackListSkeleton, type Row } from './track-list';
import { IconButton } from '@/components/ui/button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { usePageTint } from '@/components/layout/app-shell';
import { MobileTop } from '@/components/layout/mobile-top';
import { cn } from '@/components/ui/cn';

export type SortKey = 'custom' | 'title' | 'artist' | 'album' | 'added' | 'duration';

interface Props {
  art: ReactNode;
  coverForColor?: string | null;
  color?: string | null;
  eyebrow: ReactNode;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  rows: Row[] | null;
  context: PlayContext;
  variant?: 'playlist' | 'album';
  showAdded?: boolean;
  menu?: MenuItem[];
  extraActions?: ReactNode;
  onRemove?: (keys: string[]) => void;
  removeLabel?: string;
  onReorder?: (keys: string[]) => void;
  empty?: ReactNode;
  children?: ReactNode;
  round?: boolean;
  filterable?: boolean;
}

/** Shared layout for album / playlist / mix / liked pages. */
export function CollectionView({ art, coverForColor, color, eyebrow, title, description, meta, rows, context, variant = 'playlist', showAdded, menu, extraActions, onRemove, removeLabel, onReorder, empty, children, round, filterable = variant === 'playlist' }: Props) {
  const artColor = useArtColor(coverForColor);
  const c = color ?? artColor;
  usePageTint(c);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>('custom');
  const saved = useDownloads((s) => s.saved);
  const jobs = useDownloads((s) => s.jobs);

  const shown = useMemo(() => {
    if (!rows) return null;
    let r = rows;
    if (q.trim()) {
      const n = q.toLowerCase();
      r = r.filter((x) => x.track.title.toLowerCase().includes(n) || x.track.artist.toLowerCase().includes(n) || (x.track.album ?? '').toLowerCase().includes(n));
    }
    if (sort !== 'custom') {
      const key = (x: Row): string | number => (sort === 'title' ? x.track.title.toLowerCase() : sort === 'artist' ? x.track.artist.toLowerCase() : sort === 'album' ? (x.track.album ?? '').toLowerCase() : sort === 'added' ? -(x.addedAt ?? 0) : -(x.track.duration ?? 0));
      r = [...r].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    }
    return r;
  }, [rows, q, sort]);

  const tracks = rows?.map((r) => r.track) ?? [];
  const playable = tracks.filter((t) => t.playable);
  const allSaved = playable.length > 0 && playable.every((t) => saved.has(t.id));
  const downloading = playable.some((t) => jobs[t.id]);

  const SORT_LABEL: Record<SortKey, string> = { custom: 'Custom order', title: 'Title', artist: 'Artist', album: 'Album', added: 'Date added', duration: 'Duration' };
  const sortItems = (['custom', 'title', 'artist', 'album', 'added', 'duration'] as SortKey[]).map((k) => ({ label: SORT_LABEL[k], checked: sort === k, onSelect: () => setSort(k) }));
  const phoneMenu = [...(menu ?? []), ...(filterable ? [{ separator: true, label: '' }, { label: `Sort: ${SORT_LABEL[sort]}`, icon: <ArrowDownUp />, children: sortItems }] : [])];
  const shuffle = () => {
    const p = usePlayer.getState();
    if (p.context?.type === context.type && p.context?.id === context.id) p.setShuffle();
    else if (playable.length) p.playTracks(playable, { context, shuffle: true });
  };
  const download = (
    <IconButton
      label={allSaved ? 'Downloaded — remove download' : downloading ? 'Downloading…' : 'Download'}
      size="lg"
      active={allSaved}
      disabled={!playable.length}
      onClick={() => (allSaved ? void useDownloads.getState().remove(playable.map((t) => t.id)) : useDownloads.getState().enqueue(playable))}
    >
      {allSaved ? <CheckCircle2 className="text-accent" /> : <Download className={cn(downloading && 'animate-pulse')} />}
    </IconButton>
  );
  const sheetHeader = { title, subtitle: typeof eyebrow === 'string' ? eyebrow : undefined };

  return (
    <div className="animate-fade-in">
      <MobileTop title={title} back overlay large={false} />
      <PageHero art={art} eyebrow={eyebrow} title={title} description={description} meta={meta} color={c} round={round} />
      <div className="relative px-4 md:px-8">
        {/* phone actions: secondary on the left, shuffle + play on the right */}
        <div className="flex items-center gap-1 pb-3 pt-1 md:hidden">
          {download}
          {extraActions}
          {phoneMenu.length > 0 && (
            <Menu
              items={phoneMenu}
              header={sheetHeader}
              trigger={
                <span>
                  <IconButton label="More options" size="lg">
                    <MoreHorizontal />
                  </IconButton>
                </span>
              }
            />
          )}
          <div className="ml-auto flex items-center gap-3">
            <ShuffleButton onClick={shuffle} />
            <PlayFab context={context} load={() => (shown ?? []).map((r) => r.track)} size="lg" />
          </div>
        </div>
        {/* desktop actions */}
        <div className="relative flex items-center gap-3 py-5 max-md:hidden">
          <PlayFab context={context} load={() => (shown ?? []).map((r) => r.track)} size="lg" />
          <ShuffleButton onClick={shuffle} />
          {download}
          {extraActions}
          {menu && menu.length > 0 && (
            <Menu
              items={menu}
              align="start"
              trigger={
                <span>
                  <IconButton label="More options" size="lg">
                    <MoreHorizontal />
                  </IconButton>
                </span>
              }
            />
          )}
          <div className="ml-auto flex items-center gap-1">
            {filterable && (
              <div className={cn('flex items-center overflow-hidden rounded-full transition-all', searchOpen ? 'w-56 bg-surface-2' : 'w-9')}>
                <IconButton label="Search in list" size="sm" onClick={() => setSearchOpen(!searchOpen)}>
                  <Search />
                </IconButton>
                {searchOpen && (
                  <>
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in list" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Filter tracks" />
                    {q && (
                      <IconButton label="Clear" size="sm" onClick={() => setQ('')}>
                        <X />
                      </IconButton>
                    )}
                  </>
                )}
              </div>
            )}
            {filterable && (
              <Menu
                trigger={
                  <button className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-fg-2 hover:text-fg" aria-label="Sort">
                    <ArrowDownUp className="size-4" />
                    <span>{SORT_LABEL[sort]}</span>
                  </button>
                }
                items={sortItems}
              />
            )}
          </div>
        </div>
        {!shown ? (
          <TrackListSkeleton />
        ) : shown.length === 0 ? (
          q ? <p className="py-10 text-center text-sm text-fg-2">No songs match “{q}”.</p> : empty
        ) : (
          <TrackList rows={shown} context={context} variant={variant} showAdded={showAdded} onRemove={onRemove} removeLabel={removeLabel} onReorder={sort === 'custom' && !q ? onReorder : undefined} />
        )}
        {children}
      </div>
    </div>
  );
}
