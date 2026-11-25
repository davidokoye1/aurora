'use client';

import { create } from 'zustand';
import type { Track } from '@/lib/types';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

interface UIState {
  toasts: Toast[];
  addToPlaylist: { tracks: Track[] } | null;
  createPlaylist: { tracks?: Track[]; onCreated?: (id: string) => void } | null;
  confirm: { title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void } | null;
  shortcutsOpen: boolean;
  sidebarCollapsed: boolean;
  push: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  openAddToPlaylist: (tracks: Track[]) => void;
  openCreatePlaylist: (o?: UIState['createPlaylist']) => void;
  closeDialogs: () => void;
  setShortcuts: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
}

let seq = 1;
export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  addToPlaylist: null,
  createPlaylist: null,
  confirm: null,
  shortcutsOpen: false,
  sidebarCollapsed: false,
  push: (t) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 6500 : t.action ? 6000 : 3500);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openAddToPlaylist: (tracks) => set({ addToPlaylist: { tracks } }),
  openCreatePlaylist: (o) => set({ createPlaylist: o ?? {} }),
  closeDialogs: () => set({ addToPlaylist: null, createPlaylist: null }),
  setShortcuts: (v) => set({ shortcutsOpen: v }),
  setSidebarCollapsed: (v) => {
    set({ sidebarCollapsed: v });
    try {
      localStorage.setItem('aurora.sidebar', v ? '1' : '0');
    } catch {}
  },
}));

export const toast = {
  info: (message: string, action?: Toast['action']) => useUI.getState().push({ kind: 'info', message, action }),
  success: (message: string, action?: Toast['action']) => useUI.getState().push({ kind: 'success', message, action }),
  error: (message: string) => useUI.getState().push({ kind: 'error', message }),
};

export function confirmDialog(o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useUI.setState({ confirm: { ...o, resolve } }));
}
