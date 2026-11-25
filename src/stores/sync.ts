'use client';

import { create } from 'zustand';
import type { SyncProgress } from '@/lib/types';

/** Live scan/sync progress for every source, fed by one app-wide EventSource (see SyncBridge). */
export const useSyncLive = create<{ live: Record<string, SyncProgress>; set: (id: string, p: SyncProgress) => void }>((set) => ({
  live: {},
  set: (id, p) => set((s) => ({ live: { ...s.live, [id]: p } })),
}));

export function runningScans(live: Record<string, SyncProgress>) {
  return Object.values(live).filter((p) => p.status === 'running');
}
