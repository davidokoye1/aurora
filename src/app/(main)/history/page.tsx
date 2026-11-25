'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { History, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '@/lib/client/api';
import type { Track } from '@/lib/types';
import { Page } from '@/components/layout/page';
import { TrackList, TrackListSkeleton } from '@/components/media/track-list';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { confirmDialog, toast } from '@/stores/ui';
import { useSettings } from '@/lib/client/hooks';

interface H {
  id: number;
  playedAt: number;
  msPlayed: number;
  completed: boolean;
  skipped: boolean;
  track: Track;
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export default function HistoryPage() {
  const qc = useQueryClient();
  const { settings } = useSettings();
  const q = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => api<H[]>(`/api/history?limit=150&before=${pageParam}`),
    initialPageParam: Date.now() + 1000,
    getNextPageParam: (last) => (last.length === 150 ? last[last.length - 1].playedAt : undefined),
  });
  const all = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const groups = useMemo(() => {
    const g: { label: string; items: H[] }[] = [];
    for (const h of all) {
      const l = dayLabel(h.playedAt);
      if (!g.length || g[g.length - 1].label !== l) g.push({ label: l, items: [] });
      g[g.length - 1].items.push(h);
    }
    return g;
  }, [all]);
  return (
    <Page
      title="Recently Played"
      back
      subtitle={settings.privateSession ? 'Private session is on — new listening isn’t being recorded.' : 'Everything you’ve listened to, newest first.'}
      actions={
        all.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-4" />}
            onClick={async () => {
              if (await confirmDialog({ title: 'Clear listening history?', body: 'Your stats and recommendations will start fresh. This can’t be undone.', confirmLabel: 'Clear history', danger: true })) {
                await api('/api/history', { method: 'DELETE' });
                void qc.invalidateQueries({ queryKey: ['history'] });
                void qc.invalidateQueries({ queryKey: ['home'] });
                toast.success('History cleared');
              }
            }}
          >
            Clear history
          </Button>
        )
      }
    >
      {q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.isLoading ? (
        <TrackListSkeleton />
      ) : !all.length ? (
        <EmptyState icon={<History />} title="Nothing played yet" body="Songs you listen to will show up here." />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 px-4 text-sm font-bold uppercase tracking-wider text-fg-2">{g.label}</h2>
              <TrackList
                rows={g.items.map((h) => ({
                  key: String(h.id),
                  track: h.track,
                  meta: <span className="text-fg-3"> · {new Date(h.playedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{h.skipped ? ' · skipped' : ''}</span>,
                }))}
                context={{ type: 'history', title: 'Recently Played', href: '/history' }}
                variant="compact"
                removeLabel="Remove from history"
                onRemove={async (keys) => {
                  for (const k of keys) await api(`/api/history?id=${k}`, { method: 'DELETE' });
                  void qc.invalidateQueries({ queryKey: ['history'] });
                }}
              />
            </section>
          ))}
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
