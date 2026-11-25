'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, MicVocal, Trash2, GripVertical, Sparkles, Music2, Radio, Disc3 } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePlayer, type QueueItem } from '@/stores/player';
import { getEngine } from '@/lib/client/audio-engine';
import { api } from '@/lib/client/api';
import { fmtTime, fmtBytes } from '@/lib/client/format';
import { Artwork } from '@/components/ui/artwork';
import { IconButton, Button } from '@/components/ui/button';
import { Switch, PlayingBars, EmptyState } from '@/components/ui/misc';
import { ContextMenu } from '@/components/ui/menu';
import { cn } from '@/components/ui/cn';
import { useTrackMenu } from '@/components/media/track-menu';
import type { Track } from '@/lib/types';

export function RightPanel() {
  const panel = usePlayer((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="flex h-full w-[340px] shrink-0 animate-fade-in flex-col overflow-hidden rounded-[18px] bg-surface xl:w-[380px]" aria-label={panel === 'queue' ? 'Queue' : panel === 'lyrics' ? 'Lyrics' : 'Now playing'}>
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-[15px] font-bold">{panel === 'queue' ? 'Queue' : panel === 'lyrics' ? 'Lyrics' : 'Now Playing'}</h2>
        <IconButton label="Close panel" size="sm" onClick={() => usePlayer.getState().setPanel(null)}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel === 'queue' && <QueueView />}
        {panel === 'lyrics' && <LyricsView compact />}
        {panel === 'info' && <InfoView />}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ queue */

export function QueueView({ dark }: { dark?: boolean }) {
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  const context = usePlayer((s) => s.context);
  const autoplay = usePlayer((s) => s.autoplayEnabled);
  const loading = usePlayer((s) => s.autoplayLoading);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const cur = items[index];
  const upcoming = items.slice(index + 1);
  const queued = upcoming.filter((i) => i.from === 'queue');
  const ctxItems = upcoming.filter((i) => i.from === 'context');
  const auto = upcoming.filter((i) => i.from === 'autoplay');
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) usePlayer.getState().moveInQueue(String(e.active.id), String(e.over.id));
  };
  if (!cur) return <EmptyState icon={<Music2 />} title="Your queue is empty" body="Play something and it will show up here." className="py-10" />;
  return (
    <div className="px-2 pb-6">
      <h3 className="px-2 pb-2 pt-1 text-[13px] font-semibold text-fg-2">Now playing</h3>
      <QueueRow item={cur} current />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={upcoming.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          {queued.length > 0 && (
            <>
              <div className="flex items-center justify-between px-2 pb-2 pt-5">
                <h3 className="text-[13px] font-semibold text-fg-2">Next in queue</h3>
                <button onClick={() => usePlayer.getState().clearQueue()} className="text-xs font-semibold text-fg-2 hover:text-fg hover:underline">
                  Clear queue
                </button>
              </div>
              {queued.map((i) => (
                <QueueRow key={i.key} item={i} sortable />
              ))}
            </>
          )}
          {ctxItems.length > 0 && (
            <>
              <h3 className="truncate px-2 pb-2 pt-5 text-[13px] font-semibold text-fg-2">
                Next from:{' '}
                {context?.href ? (
                  <Link href={context.href} className="text-fg hover:underline">
                    {context.title}
                  </Link>
                ) : (
                  <span className="text-fg">{context?.title ?? 'your selection'}</span>
                )}
              </h3>
              {ctxItems.slice(0, 200).map((i) => (
                <QueueRow key={i.key} item={i} sortable />
              ))}
              {ctxItems.length > 200 && <p className="px-3 py-2 text-xs text-fg-3">+ {ctxItems.length - 200} more</p>}
            </>
          )}
          {auto.length > 0 && (
            <>
              <h3 className="flex items-center gap-1.5 px-2 pb-2 pt-5 text-[13px] font-semibold text-fg-2">
                <Sparkles className="size-3.5 text-accent" /> Autoplay · similar to what you’re playing
              </h3>
              {auto.map((i) => (
                <QueueRow key={i.key} item={i} sortable />
              ))}
            </>
          )}
        </SortableContext>
      </DndContext>
      <div className={cn('mx-2 mt-6 flex items-center justify-between gap-3 rounded-xl p-3', dark ? 'bg-white/10' : 'bg-surface-2')}>
        <div>
          <div className="text-sm font-semibold">Autoplay</div>
          <div className="text-xs text-fg-2">Keep the music going with similar songs when your queue ends.</div>
        </div>
        <Switch checked={autoplay} onChange={(v) => usePlayer.getState().setAutoplay(v)} label="Autoplay" />
      </div>
      {loading && <p className="px-4 pt-3 text-xs text-fg-3">Finding more songs…</p>}
    </div>
  );
}

function QueueRow({ item, current, sortable }: { item: QueueItem; current?: boolean; sortable?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const menu = useTrackMenu();
  const s = useSortable({ id: item.key, disabled: !sortable });
  const t = item.track;
  return (
    <ContextMenu items={() => [...menu([t]), ...(current ? [] : [{ separator: true, label: '' }, { label: 'Remove from queue', icon: <Trash2 />, danger: true, onSelect: () => usePlayer.getState().removeFromQueue([item.key]) }])]}>
      <div
        ref={s.setNodeRef}
        style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
        className={cn('group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-hover', s.isDragging && 'relative z-10 bg-surface-3 shadow-float')}
        onDoubleClick={() => !current && usePlayer.getState().jumpTo(item.key)}
      >
        <button onClick={() => (current ? usePlayer.getState().toggle() : usePlayer.getState().jumpTo(item.key))} className="relative shrink-0" aria-label={current ? 'Play/pause' : `Play ${t.title}`}>
          <Artwork src={t.cover} alt="" className="size-11" rounded="sm" seed={t.album ?? t.title} />
          {current && (
            <span className="absolute inset-0 flex items-center justify-center rounded-[4px] bg-black/45">
              <PlayingBars paused={!playing} />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-sm font-medium', current && 'text-accent')}>{t.title}</div>
          <div className="truncate text-xs text-fg-2">{t.artist}</div>
        </div>
        {!current && (
          <>
            <button aria-label={`Remove ${t.title} from queue`} onClick={() => usePlayer.getState().removeFromQueue([item.key])} className="rounded-full p-1.5 text-fg-3 opacity-0 transition hover:text-fg group-hover:opacity-100">
              <X className="size-4" />
            </button>
            <span {...s.attributes} {...s.listeners} aria-label="Drag to reorder" className="cursor-grab touch-none p-1 text-fg-3 opacity-0 group-hover:opacity-100">
              <GripVertical className="size-4" />
            </span>
          </>
        )}
      </div>
    </ContextMenu>
  );
}

/* ------------------------------------------------------------------ lyrics */

interface LyricsData {
  synced: { t: number; text: string }[] | null;
  plain: string | null;
  source: string | null;
}

export function LyricsView({ compact, color }: { compact?: boolean; color?: string | null }) {
  const cur = usePlayer((s) => s.items[s.index]?.track);
  const time = usePlayer((s) => s.time);
  const playing = usePlayer((s) => s.playing);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['lyrics', cur?.id],
    queryFn: () => api<LyricsData>(`/api/lyrics/${cur!.id}`),
    enabled: !!cur,
    staleTime: Infinity,
  });
  const [t, setT] = useState(time);
  useEffect(() => setT(time), [time]);
  useEffect(() => {
    if (!playing) return;
    let r = 0;
    const tick = () => {
      setT(getEngine().time);
      r = requestAnimationFrame(tick);
    };
    r = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r);
  }, [playing]);
  const active = useMemo(() => {
    if (!data?.synced) return -1;
    let i = -1;
    for (let k = 0; k < data.synced.length; k++) if (data.synced[k].t <= t + 0.25) i = k;
    return i;
  }, [data, t]);
  const box = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(0);
  useEffect(() => {
    if (active < 0 || !box.current || Date.now() - userScrolled.current < 3500) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  if (!cur) return <EmptyState icon={<MicVocal />} title="No song playing" className="py-10" />;
  if (isLoading) return <div className="space-y-4 p-6">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-6 rounded" style={{ width: `${50 + ((i * 37) % 45)}%` }} />)}</div>;
  if (!data?.synced && !data?.plain)
    return (
      <EmptyState
        icon={<MicVocal />}
        title="No lyrics found"
        body={cur.kind === 'podcast' ? 'Episodes don’t have lyrics.' : 'We couldn’t find lyrics for this song in its tags or on LRCLIB.'}
        action={cur.kind !== 'podcast' && <Button size="sm" onClick={() => void api(`/api/lyrics/${cur.id}?refresh=1`).then(() => refetch())} loading={isFetching}>Search again</Button>}
        className="py-10"
      />
    );
  return (
    <div
      ref={box}
      onWheel={() => (userScrolled.current = Date.now())}
      onTouchMove={() => (userScrolled.current = Date.now())}
      className={cn('h-full overflow-y-auto px-6 py-6', compact ? 'text-xl' : 'text-2xl md:text-[34px]')}
      style={color ? { background: `linear-gradient(180deg, ${color}55, transparent)` } : undefined}
    >
      {data.synced ? (
        <div className="space-y-4 pb-[40vh] pt-[10vh] font-bold leading-snug tracking-tight">
          {data.synced.map((l, i) => (
            <button
              key={i}
              data-line={i}
              onClick={() => usePlayer.getState().seek(l.t)}
              className={cn('block w-full text-left transition-all duration-300 hover:opacity-100', i === active ? 'scale-[1.0] text-fg opacity-100' : i < active ? 'text-fg opacity-40' : 'text-fg opacity-55')}
            >
              {l.text || '♪'}
            </button>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap pb-20 font-semibold leading-relaxed text-fg/90">{data.plain}</div>
      )}
      {data.source && <p className="mt-6 text-xs font-medium text-fg-3">Lyrics provided by {data.source}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ info */

interface TrackInfo {
  track: Track;
  copies: { id: string; format: string | null; bitrate: number | null; size: number | null; playable: number; source: string; source_type: string }[];
  plays: { c: number; last: number | null };
}

export function InfoView() {
  const cur = usePlayer((s) => s.items[s.index]?.track);
  const ctx = usePlayer((s) => s.context);
  const { data } = useQuery({ queryKey: ['track-info', cur?.id], queryFn: () => api<TrackInfo>(`/api/tracks/${cur!.id}`), enabled: !!cur });
  if (!cur) return <EmptyState icon={<Music2 />} title="Nothing playing" className="py-10" />;
  return (
    <div className="space-y-4 px-4 pb-6">
      <Artwork src={cur.cover} alt={cur.album ?? cur.title} className="aspect-square w-full shadow-float" rounded="lg" seed={cur.album ?? cur.title} />
      <div>
        <div className="font-display text-2xl font-bold leading-tight">{cur.title}</div>
        <div className="mt-1 text-fg-2">
          {cur.artistId ? <Link href={`/artist/${cur.artistId}`} className="hover:text-fg hover:underline">{cur.artist}</Link> : cur.artist}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/radio?track=${cur.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-surface-3"><Radio className="size-3.5" /> Song radio</Link>
        {cur.albumId && <Link href={`/album/${cur.albumId}`} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-surface-3"><Disc3 className="size-3.5" /> {cur.album}</Link>}
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-4 text-sm">
        {ctx && <Info label="Playing from" value={ctx.title} />}
        {cur.year && <Info label="Year" value={String(cur.year)} />}
        {cur.genre && <Info label="Genre" value={cur.genre} />}
        <Info label="Duration" value={fmtTime(cur.duration)} />
        {cur.bpm && <Info label="Tempo" value={`${Math.round(cur.bpm)} BPM`} />}
        {cur.energy != null && <Info label="Energy" value={`${Math.round(cur.energy * 100)}%`} />}
        {data && <Info label="Your plays" value={String(data.plays.c)} />}
      </dl>
      {data?.copies && (
        <div className="rounded-xl bg-surface-2 p-4">
          <div className="mb-2 text-sm font-semibold">Sources</div>
          <ul className="space-y-2 text-xs text-fg-2">
            {data.copies.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{c.source}</span>
                <span className="shrink-0 font-mono uppercase">
                  {c.format ?? '?'}{c.bitrate ? ` · ${c.bitrate} kbps` : ''}{c.size ? ` · ${fmtBytes(c.size)}` : ''}{!c.playable && ' · unsupported'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
