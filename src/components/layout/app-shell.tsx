'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { create } from 'zustand';
import { Home, Search, Library, WifiOff, Download } from 'lucide-react';
import type { Me } from '@/lib/types';
import { MeContext, useMe, useOnline, useLike } from '@/lib/client/hooks';
import { usePlayer, wirePlayer } from '@/stores/player';
import { useUI } from '@/stores/ui';
import { useDownloads } from '@/stores/downloads';
import { getEngine } from '@/lib/client/audio-engine';
import { Sidebar, isActive } from './sidebar';
import { TopBar } from './topbar';
import { ActionSheetHost } from '@/components/ui/sheet';
import { SyncBridge } from '@/components/sources/scan-banner';
import { PlayerBar, MiniPlayer } from '@/components/player/player-bar';
import { FullPlayer } from '@/components/player/full-player';
import { RightPanel } from '@/components/player/panels';
import { AddToPlaylistDialog, ConfirmDialog, CreatePlaylistDialog, ShortcutsDialog, Toaster } from '@/components/dialogs/dialogs';
import { cn } from '@/components/ui/cn';

/** Pages can push a header node / tint colour into the shell. */
export const useShell = create<{ header: ReactNode; tint: string | null; setHeader: (n: ReactNode) => void; setTint: (c: string | null) => void }>((set) => ({
  header: null,
  tint: null,
  setHeader: (header) => set({ header }),
  setTint: (tint) => set({ tint }),
}));

export function usePageTint(color: string | null | undefined) {
  useEffect(() => {
    useShell.getState().setTint(color ?? null);
    return () => useShell.getState().setTint(null);
  }, [color]);
}

export function AppProviders({ me, children }: { me: Me; children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: (n, e) => n < 2 && (e as { status?: number }).status !== 404 && (e as { status?: number }).status !== 401, refetchOnWindowFocus: false },
        },
      }),
  );
  useEffect(() => {
    qc.setQueryData(['me'], me);
  }, [qc, me]);
  return (
    <QueryClientProvider client={qc}>
      <MeContext.Provider value={me}>
        <Tooltip.Provider delayDuration={450} skipDelayDuration={200}>
          {children}
        </Tooltip.Provider>
      </MeContext.Provider>
    </QueryClientProvider>
  );
}

const MOBILE_TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/downloads', label: 'Downloads', icon: Download },
];

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const path = usePathname();
  const router = useRouter();
  const online = useOnline();
  const hasTrack = usePlayer((s) => s.index >= 0);
  const header = useShell((s) => s.header);
  const tint = useShell((s) => s.tint);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const like = useLike();
  const s = me.settings;

  // Boot: player wiring, offline index, service worker, sidebar preference
  useEffect(() => {
    wirePlayer();
    void useDownloads.getState().refresh();
    try {
      if (localStorage.getItem('aurora.sidebar') === '1') useUI.getState().setSidebarCollapsed(true);
    } catch {}
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);

  // Apply theme + audio settings whenever they change
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    root.dataset.reduceMotion = String(s.reduceMotion);
    root.style.setProperty('--accent', s.theme === 'light' && s.accent === '#ff5b2e' ? '#e8431a' : s.accent);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.theme === 'light' ? '#f3efe8' : s.theme === 'oled' ? '#000000' : '#111010');
    getEngine().setOptions({ crossfade: s.crossfade, gapless: s.gapless, normalize: s.normalize, eqEnabled: s.eqEnabled, eqBands: s.eqBands, quality: s.quality });
    usePlayer.setState({ privateSession: s.privateSession });
    useDownloads.getState().setQuality(s.downloadQuality);
  }, [s]);

  // Reset scroll + header on navigation
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [path]);

  // Keyboard shortcuts
  useEffect(() => {
    let gPending = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = usePlayer.getState();
      const k = e.key;
      if (Date.now() - gPending < 1200) {
        gPending = 0;
        const dest = { h: '/', l: '/library', d: '/discover', s: '/settings', p: '/playlists', r: '/history' }[k.toLowerCase()];
        if (dest) {
          e.preventDefault();
          router.push(dest);
          return;
        }
      }
      switch (k) {
        case ' ':
          if (el.closest('button, a, [role="row"]')) return;
          e.preventDefault();
          p.toggle();
          break;
        case 'ArrowRight':
          if (el.closest('[role="slider"], input[type="range"]')) return;
          e.preventDefault();
          if (e.shiftKey) p.next();
          else p.seek(getEngine().time + 5);
          break;
        case 'ArrowLeft':
          if (el.closest('[role="slider"], input[type="range"]')) return;
          e.preventDefault();
          if (e.shiftKey) p.prev();
          else p.seek(Math.max(0, getEngine().time - 5));
          break;
        case 'ArrowUp':
          if (el.closest('[role="grid"], [role="menu"]')) return;
          e.preventDefault();
          p.setVolume(p.volume + 0.05);
          break;
        case 'ArrowDown':
          if (el.closest('[role="grid"], [role="menu"]')) return;
          e.preventDefault();
          p.setVolume(p.volume - 0.05);
          break;
        case 'm':
        case 'M':
          p.toggleMute();
          break;
        case 's':
        case 'S':
          p.setShuffle();
          break;
        case 'r':
        case 'R':
          p.cycleRepeat();
          break;
        case 'l':
        case 'L': {
          const cur = p.current();
          if (cur) void like([cur.track]);
          break;
        }
        case 'q':
        case 'Q':
          p.togglePanel('queue');
          break;
        case 'y':
        case 'Y':
          p.togglePanel('lyrics');
          break;
        case 'f':
        case 'F':
          if (p.current()) p.setFull(!p.fullOpen);
          break;
        case '/':
          e.preventDefault();
          router.push('/search');
          setTimeout(() => document.querySelector<HTMLInputElement>('#search-input')?.focus(), 60);
          break;
        case '?':
          useUI.getState().setShortcuts(true);
          break;
        case 'g':
        case 'G':
          gPending = Date.now();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, like]);

  return (
    <div
      className="shell flex h-dvh flex-col overflow-hidden bg-bg"
      style={{ ['--player-h' as string]: hasTrack ? '96px' : '0px', ['--dock' as string]: hasTrack ? 'calc(124px + env(safe-area-inset-bottom))' : 'calc(58px + env(safe-area-inset-bottom))' }}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      {!online && (
        <div className="safe-top flex shrink-0 items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-[13px] font-medium text-warning max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:z-50">
          <WifiOff className="size-4 shrink-0" /> Offline — downloads still play.
          <Link href="/downloads" className="font-bold underline">
            Downloads
          </Link>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2 p-2 max-md:p-0">
        <div className="max-md:hidden">
          <Sidebar />
        </div>
        <main id="main" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-surface max-md:rounded-none max-md:bg-bg">
          <div
            ref={scroller}
            onScroll={(e) => setScrolled((e.target as HTMLDivElement).scrollTop > 40)}
            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
            id="main-scroll"
          >
            <div className="max-md:hidden">
              <TopBar scrolled={scrolled} tint={tint}>
                {header}
              </TopBar>
            </div>
            <div className="pb-[calc(var(--dock)+24px)] md:-mt-16 md:pb-10">{children}</div>
          </div>
        </main>
        <div className="max-lg:hidden">
          <RightPanel />
        </div>
      </div>
      {hasTrack && (
        <div className="shrink-0 border-t border-line bg-bg max-md:hidden">
          <PlayerBar />
        </div>
      )}
      {/* Phone dock: mini player + tab bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
        {hasTrack && <MiniPlayer />}
        <nav className="safe-bottom flex items-stretch border-t border-line bg-[var(--tab-bg)]" aria-label="Primary">
          {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(path, href) || (href === '/library' && ['/playlists', '/liked', '/playlist', '/album', '/artist', '/collection', '/history', '/sources', '/setup'].some((p) => path.startsWith(p))) || (href === '/' && ['/mix', '/mood', '/genre', '/discover', '/radio'].some((p) => path.startsWith(p)));
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('press flex h-[58px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold', active ? 'text-fg' : 'text-fg-3')}>
                <Icon className="size-[24px]" strokeWidth={active ? 2.3 : 1.8} />
                <span>{label}</span>
                <span className={cn('size-1 rounded-full', active ? 'bg-accent' : 'bg-transparent')} aria-hidden />
              </Link>
            );
          })}
        </nav>
      </div>
      <FullPlayer />
      <CreatePlaylistDialog />
      <AddToPlaylistDialog />
      <ConfirmDialog />
      <ShortcutsDialog />
      <ActionSheetHost />
      <SyncBridge />
      <Toaster />
      <LiveAnnouncer />
    </div>
  );
}

function brighten(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b);
  const k = max < 150 ? 170 / Math.max(1, max) : 1;
  r = Math.min(255, r * k);
  g = Math.min(255, g * k);
  b = Math.min(255, b * k);
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Screen-reader announcement for track changes. */
function LiveAnnouncer() {
  const cur = usePlayer((s) => s.items[s.index]?.track);
  return (
    <div className="sr-only" aria-live="polite">
      {cur ? `Now playing ${cur.title} by ${cur.artist}` : ''}
    </div>
  );
}
