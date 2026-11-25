'use client';

import Link from 'next/link';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Play, Pause, Heart, MoreHorizontal, Clock3, GripVertical, ArrowDownCircle, Ban } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Track } from '@/lib/types';
import { usePlayer, type PlayContext } from '@/stores/player';
import { useDownloads } from '@/stores/downloads';
import { useLike, useMediaQuery } from '@/lib/client/hooks';
import { fmtAgo, fmtTime } from '@/lib/client/format';
import { Artwork } from '@/components/ui/artwork';
import { ContextMenu, Menu } from '@/components/ui/menu';
import { PlayingBars } from '@/components/ui/misc';
import { Tip } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { useTrackMenu } from './track-menu';

export interface Row {
  key: string;
  track: Track;
  addedAt?: number;
  addedBy?: string | null;
  meta?: ReactNode;
}

interface Props {
  rows: Row[];
  context: PlayContext | null;
  variant?: 'playlist' | 'album' | 'compact' | 'search';
  showAlbum?: boolean;
  showAdded?: boolean;
  showArt?: boolean;
  showHeader?: boolean;
  onRemove?: (keys: string[]) => void;
  removeLabel?: string;
  onReorder?: (keys: string[]) => void;
  startNumber?: number;
  emptyHint?: ReactNode;
}

export function TrackList({ rows, context, variant = 'playlist', showAlbum = variant === 'playlist' || variant === 'search', showAdded = false, showArt = variant !== 'album', showHeader = variant !== 'compact', onRemove, removeLabel, onReorder, startNumber = 1 }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const touch = useMediaQuery('(pointer: coarse)');
  const tracks = useMemo(() => rows.map((r) => r.track), [rows]);
  const play = useCallback(
    (i: number) => usePlayer.getState().playTracks(tracks, { startIndex: i, context, shuffle: false }),
    [tracks, context],
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onSelect = (key: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      if (e.shiftKey && anchor) {
        const a = rows.findIndex((r) => r.key === anchor);
        const b = rows.findIndex((r) => r.key === key);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return new Set(rows.slice(lo, hi + 1).map((r) => r.key));
      }
      if (e.metaKey || e.ctrlKey) {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      }
      return new Set([key]);
    });
    if (!e.shiftKey) setAnchor(key);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!onReorder || !e.over || e.active.id === e.over.id) return;
    const from = rows.findIndex((r) => r.key === e.active.id);
    const to = rows.findIndex((r) => r.key === e.over!.id);
    onReorder(arrayMove(rows, from, to).map((r) => r.key));
  };

  const selectedRows = (key: string) => (selected.has(key) && selected.size > 1 ? rows.filter((r) => selected.has(r.key)) : rows.filter((r) => r.key === key));

  const body = rows.map((r, i) => (
    <TrackRowItem
      key={r.key}
      row={r}
      index={i}
      number={startNumber + i}
      variant={variant}
      showAlbum={showAlbum}
      showAdded={showAdded}
      showArt={showArt}
      selected={selected.has(r.key)}
      sortable={!!onReorder}
      touch={touch}
      onSelect={onSelect}
      onPlay={play}
      selectedRows={selectedRows}
      onRemove={onRemove}
      removeLabel={removeLabel}
    />
  ));

  return (
    <div role="grid" aria-label="Tracks" aria-rowcount={rows.length} onKeyDown={(e) => {
      if (e.key === 'Escape') setSelected(new Set());
    }}>
      {showHeader && variant !== 'compact' && !touch && (
        <div className="mb-2 flex items-center gap-4 border-b border-line px-4 pb-2 text-xs font-medium uppercase tracking-wider text-fg-3" role="row">
          {onReorder && !touch && <span className="w-4" />}
          <span className="w-7 text-right">#</span>
          <span className="min-w-0 flex-[4]">Title</span>
          {showAlbum && <span className="hidden min-w-0 flex-[3] lg:block">Album</span>}
          {showAdded && <span className="hidden min-w-0 flex-[2] xl:block">Date added</span>}
          <span className="flex w-[108px] justify-end pr-9 max-sm:w-16 max-sm:pr-0"><Clock3 className="size-4 max-sm:hidden" aria-label="Duration" /></span>
        </div>
      )}
      {onReorder ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            {body}
          </SortableContext>
        </DndContext>
      ) : (
        body
      )}
    </div>
  );
}

interface RowProps {
  row: Row;
  index: number;
  number: number;
  variant: NonNullable<Props['variant']>;
  showAlbum: boolean;
  showAdded: boolean;
  showArt: boolean;
  selected: boolean;
  sortable: boolean;
  touch: boolean;
  onSelect: (key: string, e: React.MouseEvent) => void;
  onPlay: (i: number) => void;
  selectedRows: (key: string) => Row[];
  onRemove?: (keys: string[]) => void;
  removeLabel?: string;
}

const TrackRowItem = memo(function TrackRowItem({ row, index, number, variant, showAlbum, showAdded, showArt, selected, sortable, touch, onSelect, onPlay, selectedRows, onRemove, removeLabel }: RowProps) {
  const t = row.track;
  const isCurrent = usePlayer((s) => s.items[s.index]?.track.id === t.id);
  const playing = usePlayer((s) => s.playing);
  const downloaded = useDownloads((s) => s.saved.has(t.id));
  const usable = t.playable && (!t.offline || downloaded);
  const like = useLike();
  const menu = useTrackMenu();
  const sort = useSortable({ id: row.key, disabled: !sortable });
  const style = sortable ? { transform: CSS.Transform.toString(sort.transform), transition: sort.transition } : undefined;

  const items = () => {
    const rs = selectedRows(row.key);
    return menu(
      rs.map((r) => r.track),
      onRemove ? { onRemove: () => onRemove(rs.map((r) => r.key)), removeLabel } : {},
    );
  };

  const sheetHeader = () => ({ art: <Artwork src={t.cover} alt="" className="size-12" rounded="sm" seed={t.album ?? t.title} />, title: t.title, subtitle: [t.artist, t.album].filter(Boolean).join(' · ') });

  const toggle = () => {
    if (isCurrent) usePlayer.getState().toggle();
    else onPlay(index);
  };

  return (
    <ContextMenu items={items} header={sheetHeader}>
      <div
        ref={sort.setNodeRef}
        style={style}
        role="row"
        aria-selected={selected}
        tabIndex={0}
        onClick={(e) => (touch ? usable && toggle() : onSelect(row.key, e))}
        onDoubleClick={() => usable && !touch && onPlay(index)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && usable) onPlay(index);
        }}
        className={cn(
          'row-cv no-callout group flex items-center rounded-lg outline-none transition-colors',
          touch ? 'h-16 gap-3 px-4 active:bg-active' : 'h-14 gap-4 px-4',
          variant === 'compact' && !touch && 'px-2',
          selected ? 'bg-active' : 'hover:bg-hover focus-visible:bg-hover',
          sort.isDragging && 'relative z-10 bg-surface-3 shadow-float',
          !usable && 'opacity-45',
        )}
      >
        {sortable && !touch && (
          <span {...sort.attributes} {...sort.listeners} className="flex w-4 cursor-grab touch-none items-center text-fg-3 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing" aria-label="Drag to reorder" onClick={(e) => e.stopPropagation()}>
            <GripVertical className="size-4" />
          </span>
        )}
        {variant !== 'compact' && !touch && (
          <div className="relative flex w-7 shrink-0 justify-end text-[15px] tabular-nums text-fg-2">
            <span className={cn('group-hover:invisible', isCurrent && 'text-accent')}>{isCurrent ? <PlayingBars paused={!playing} /> : variant === 'album' ? t.trackNo ?? number : number}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (usable) toggle();
              }}
              disabled={!usable}
              aria-label={isCurrent && playing ? `Pause ${t.title}` : `Play ${t.title}`}
              className="invisible absolute right-0 top-1/2 -translate-y-1/2 text-fg group-hover:visible"
            >
              {!usable ? <Ban className="size-4" /> : isCurrent && playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
            </button>
          </div>
        )}
        <div className="flex min-w-0 flex-[4] items-center gap-3">
          {showArt && (
            <div className="relative">
              <Artwork src={t.cover} alt="" className={touch ? 'size-12' : 'size-10'} rounded="sm" seed={t.album ?? t.title} />
              {variant === 'compact' && !touch && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (usable) toggle();
                  }}
                  aria-label={`Play ${t.title}`}
                  className={cn('absolute inset-0 flex items-center justify-center rounded-[4px] bg-black/50 text-white transition', isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                >
                  {isCurrent && playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
                </button>
              )}
            </div>
          )}
          <div className="min-w-0">
            <div className={cn('flex items-center gap-2 truncate font-medium', touch ? 'text-[16px]' : 'text-[15px]', isCurrent ? 'text-accent' : 'text-fg')}>
              {touch && isCurrent && <PlayingBars paused={!playing} className="shrink-0" />}
              {touch && variant === 'album' && t.trackNo != null && !isCurrent && <span className="w-5 shrink-0 text-[14px] tabular-nums text-fg-3">{t.trackNo}</span>}
              <span className="truncate">{t.title}</span>
            </div>
            <div className={cn('flex min-w-0 items-center gap-1.5 text-fg-2', touch ? 'text-[14px]' : 'text-[13px]', touch && variant === 'album' && t.trackNo != null && 'pl-7')}>
              {t.explicit && <span className="flex h-4 shrink-0 items-center rounded-[3px] bg-fg-3/40 px-1 text-[10px] font-bold text-fg" aria-label="Explicit">E</span>}
              {t.offline && !downloaded && <span className="shrink-0 text-[12px] text-fg-3">Drive not connected ·</span>}
              {downloaded && <ArrowDownCircle className="size-3.5 shrink-0 text-accent" aria-label="Downloaded" />}
              {variant !== 'album' || t.artistId !== null ? (
                t.artistId ? (
                  <Link href={`/artist/${t.artistId}`} onClick={(e) => e.stopPropagation()} className={cn('truncate hover:text-fg hover:underline', touch && 'pointer-events-none')}>
                    {t.artist}
                  </Link>
                ) : (
                  <span className="truncate">{t.artist}</span>
                )
              ) : null}
              {variant === 'compact' && t.album && <span className="hidden truncate sm:inline">· {t.album}</span>}
              {row.meta}
            </div>
          </div>
        </div>
        {showAlbum && variant !== 'compact' && (
          <div className="hidden min-w-0 flex-[3] truncate text-sm text-fg-2 lg:block">
            {t.albumId ? (
              <Link href={`/album/${t.albumId}`} onClick={(e) => e.stopPropagation()} className="hover:text-fg hover:underline">
                {t.album}
              </Link>
            ) : (
              t.album
            )}
          </div>
        )}
        {showAdded && variant !== 'compact' && <div className="hidden min-w-0 flex-[2] truncate text-sm text-fg-2 xl:block">{row.addedAt ? fmtAgo(row.addedAt) : ''}{row.addedBy ? <span className="text-fg-3"> · {row.addedBy}</span> : null}</div>}
        <div className="flex shrink-0 items-center justify-end gap-1">
          <Tip label={t.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void like([t]);
              }}
              aria-label={t.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
              className={cn('rounded-full transition active:scale-75', touch ? 'p-2' : 'p-1.5', t.liked ? 'text-accent' : touch ? 'hidden' : 'text-fg-2 opacity-0 hover:text-fg group-hover:opacity-100')}
            >
              <Heart className={cn('size-4', t.liked && 'fill-current')} />
            </button>
          </Tip>
          {!touch && <span className="w-11 text-right text-sm tabular-nums text-fg-2">{fmtTime(t.duration)}</span>}
          <Menu
            items={items}
            header={sheetHeader}
            trigger={
              <button onClick={(e) => e.stopPropagation()} aria-label={`More options for ${t.title}`} className={cn('rounded-full text-fg-2 transition hover:text-fg', touch ? 'flex size-11 items-center justify-center' : 'p-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
                <MoreHorizontal className={touch ? 'size-6' : 'size-5'} />
              </button>
            }
          />
          {sortable && touch && (
            <span {...sort.attributes} {...sort.listeners} className="-mr-2 flex size-11 touch-none items-center justify-center text-fg-3" aria-label="Drag to reorder" onClick={(e) => e.stopPropagation()}>
              <GripVertical className="size-5" />
            </span>
          )}
        </div>
      </div>
    </ContextMenu>
  );
});

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-14 items-center gap-4 px-4">
          <div className="skeleton h-3 w-5 rounded" />
          <div className="skeleton size-10 rounded" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/3 rounded" />
            <div className="skeleton h-3 w-1/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export const rowsOf = (tracks: Track[]): Row[] => tracks.map((t, i) => ({ key: `${t.id}:${i}`, track: t }));
