'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, HardDrive, Pause, Play, X, Trash2, RotateCw, WifiOff, Shuffle } from 'lucide-react';
import type { Track } from '@/lib/types';
import { useDownloads } from '@/stores/downloads';
import { offlineDb, storageEstimate } from '@/lib/client/offline';
import { fmtBytes, plural, fmtAgo } from '@/lib/client/format';
import { useOnline, useSettings } from '@/lib/client/hooks';
import { Page } from '@/components/layout/page';
import { TrackList } from '@/components/media/track-list';
import { Artwork } from '@/components/ui/artwork';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { usePlayer } from '@/stores/player';
import { confirmDialog, toast } from '@/stores/ui';
import { cn } from '@/components/ui/cn';

export default function DownloadsPage() {
  const online = useOnline();
  const jobs = useDownloads((s) => s.jobs);
  const saved = useDownloads((s) => s.saved);
  const { settings, update } = useSettings();
  const [entries, setEntries] = useState<{ id: string; track: Track; size: number; savedAt: number }[] | null>(null);
  const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  useEffect(() => {
    void offlineDb.list().then((l) => setEntries(l.sort((a, b) => b.savedAt - a.savedAt))).catch(() => setEntries([]));
    void storageEstimate().then(setEst);
  }, [saved]);
  const active = Object.values(jobs);
  const used = entries?.reduce((s, e) => s + e.size, 0) ?? 0;
  const tracks = useMemo(() => entries?.map((e) => ({ ...e.track, playable: true })) ?? [], [entries]);
  const ctx = { type: 'downloads' as const, title: 'Downloads', href: '/downloads' };
  return (
    <Page
      title="Downloads"
      subtitle={entries ? `${plural(entries.length, 'song')} available offline · ${fmtBytes(used)}` : undefined}
      actions={
        entries && entries.length > 0 && (
          <>
            <Button variant="primary" icon={<Play className="size-4 fill-current" />} onClick={() => usePlayer.getState().playTracks(tracks, { context: ctx, shuffle: false })}>Play all</Button>
            <Button icon={<Shuffle className="size-4" />} onClick={() => usePlayer.getState().playTracks(tracks, { context: ctx, shuffle: true })}>Shuffle</Button>
          </>
        )
      }
    >
      {!online && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-warning/10 p-4 text-sm text-warning">
          <WifiOff className="size-5" /> You’re offline. Everything on this page still plays.
        </div>
      )}
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        <div className="rounded-[18px] bg-surface-2 p-5 md:col-span-2">
          <div className="flex items-center gap-2 font-semibold"><HardDrive className="size-4" /> Storage</div>
          {est ? (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (est.usage / Math.max(1, est.quota)) * 100)}%` }} />
              </div>
              <p className="mt-2 text-[13px] text-fg-2">
                Aurora downloads use {fmtBytes(used)} · this browser has used {fmtBytes(est.usage)} of about {fmtBytes(est.quota)} available.{' '}
                {est.persisted ? 'Storage is persistent.' : 'The browser may clear downloads if storage runs low.'}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-fg-2">Storage information isn’t available in this browser.</p>
          )}
        </div>
        <div className="rounded-[18px] bg-surface-2 p-5">
          <div className="font-semibold">Download quality</div>
          <div className="mt-3 flex gap-2">
            {(['best', 'smallest'] as const).map((q) => (
              <button key={q} onClick={() => update({ downloadQuality: q })} className={cn('flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition', settings.downloadQuality === q ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-hover')}>
                {q === 'best' ? 'Best' : 'Data saver'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-3">“Best” keeps lossless copies when a source has them.</p>
        </div>
      </div>
      {active.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-2xl font-bold">In progress</h2>
          <div className="space-y-1">
            {active.map((j) => (
              <div key={j.trackId} className="flex items-center gap-3 rounded-xl p-2 hover:bg-hover">
                <Artwork src={j.track.cover} alt="" className="size-11" rounded="sm" seed={j.track.album ?? j.track.title} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{j.track.title}</div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className={cn('h-full rounded-full', j.status === 'error' ? 'bg-danger' : 'bg-accent')} style={{ width: j.total ? `${(j.received / j.total) * 100}%` : j.status === 'downloading' ? '30%' : '0%' }} />
                  </div>
                  <div className="mt-1 text-xs text-fg-2">
                    {j.status === 'error' ? <span className="text-danger">{j.error}</span> : j.status === 'queued' ? 'Waiting…' : j.status === 'paused' ? 'Paused' : `${fmtBytes(j.received)}${j.total ? ` of ${fmtBytes(j.total)}` : ''}`}
                  </div>
                </div>
                {j.status === 'downloading' && <IconButton label="Pause" size="sm" onClick={() => useDownloads.getState().pause(j.trackId)}><Pause /></IconButton>}
                {(j.status === 'paused' || j.status === 'error') && <IconButton label={j.status === 'error' ? 'Retry' : 'Resume'} size="sm" onClick={() => useDownloads.getState().resume(j.trackId)}>{j.status === 'error' ? <RotateCw /> : <Play />}</IconButton>}
                <IconButton label="Cancel" size="sm" onClick={() => useDownloads.getState().cancel(j.trackId)}><X /></IconButton>
              </div>
            ))}
          </div>
        </section>
      )}
      {entries && entries.length === 0 && !active.length ? (
        <EmptyState icon={<Download />} title="Take your music offline" body="Download songs, albums or playlists with the download button — they’ll play here even without a connection." />
      ) : entries && entries.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Downloaded</h2>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (await confirmDialog({ title: 'Remove all downloads?', body: `This frees ${fmtBytes(used)} on this device.`, confirmLabel: 'Remove all', danger: true })) {
                  await useDownloads.getState().removeAll();
                  toast.success('All downloads removed');
                }
              }}
            >
              Remove all
            </Button>
          </div>
          <TrackList
            rows={entries.map((e) => ({ key: e.id, track: { ...e.track, playable: true }, addedAt: e.savedAt, meta: <span className="text-fg-3"> · {fmtBytes(e.size)} · {fmtAgo(e.savedAt)}</span> }))}
            context={ctx}
            variant="search"
            removeLabel="Remove download"
            onRemove={(keys) => void useDownloads.getState().remove(keys)}
          />
        </section>
      ) : null}
    </Page>
  );
}
