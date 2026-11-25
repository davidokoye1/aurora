'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useSyncLive, runningScans } from '@/stores/sync';
import type { SyncProgress } from '@/lib/types';

const VIEWS = ['home', 'library', 'playlists', 'search', 'genres', 'sources', 'artist', 'album'];

/** Mounted once in the app shell: streams sync progress and refreshes library views as songs arrive. */
export function SyncBridge() {
  const qc = useQueryClient();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const refresh = () => {
      last.current = Date.now();
      for (const k of VIEWS) void qc.invalidateQueries({ queryKey: [k] });
    };
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      es = new EventSource('/api/sources/events');
      es.addEventListener('progress', (e) => {
        const { sourceId, progress } = JSON.parse((e as MessageEvent).data) as { sourceId: string; progress: SyncProgress };
        const prev = useSyncLive.getState().live[sourceId];
        useSyncLive.getState().set(sourceId, progress);
        if (progress.status !== 'running') {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          refresh();
        } else if (progress.imported > (prev?.imported ?? 0) && !timer.current) {
          // songs are arriving: refresh the views every few seconds so they appear while scanning
          timer.current = setTimeout(() => {
            timer.current = null;
            refresh();
          }, Math.max(0, 4000 - (Date.now() - last.current)));
        }
      });
      es.onerror = () => {
        es?.close();
        retry = setTimeout(open, 5000);
      };
    };
    open();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [qc]);
  return null;
}

/** Slim "Scanning your music…" strip, shown while any source is importing. */
export function ScanBanner() {
  const live = useSyncLive((s) => s.live);
  const running = runningScans(live);
  if (!running.length) return null;
  const found = running.reduce((a, p) => a + p.found, 0);
  const done = running.reduce((a, p) => a + p.imported + (p.unchanged ?? 0) + p.errors, 0);
  const added = running.reduce((a, p) => a + p.imported, 0);
  const pct = found ? Math.min(100, (done / found) * 100) : 0;
  return (
    <Link href="/sources" className="block rounded-[14px] bg-surface-2 px-4 py-3" aria-live="polite">
      <div className="flex items-center gap-2.5 text-[14px] font-semibold">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
        <span className="min-w-0 flex-1 truncate">Scanning your music…</span>
        <span className="shrink-0 text-[13px] font-medium tabular-nums text-fg-2">
          {added > 0 ? `${added.toLocaleString()} new` : `${done.toLocaleString()} of ${found.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </Link>
  );
}
