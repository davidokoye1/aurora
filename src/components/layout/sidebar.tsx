'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Home, Search, Compass, Library, ListMusic, Download, History, BarChart3, Settings, Plus, Heart, PanelLeftClose, PanelLeftOpen, Server, Volume2, Users,
} from 'lucide-react';
import { usePlaylists, useMediaQuery } from '@/lib/client/hooks';
import { useUI } from '@/stores/ui';
import { usePlayer } from '@/stores/player';
import { Mosaic, Artwork } from '@/components/ui/artwork';
import { IconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Skeleton } from '@/components/ui/misc';

export const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/discover', label: 'Make a Mix', icon: Compass },
  { href: '/library', label: 'Your Library', icon: Library },
  { href: '/playlists', label: 'Playlists', icon: ListMusic },
  { href: '/downloads', label: 'Downloads', icon: Download },
  { href: '/history', label: 'Recently Played', icon: History },
  { href: '/stats', label: 'Your Stats', icon: BarChart3 },
  { href: '/sources', label: 'Music Sources', icon: Server },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

export function Sidebar() {
  const path = usePathname();
  const userCollapsed = useUI((s) => s.sidebarCollapsed);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const collapsed = userCollapsed || narrow;
  const setCollapsed = useUI((s) => s.setSidebarCollapsed);
  const { data: playlists, isLoading } = usePlaylists();
  const ctx = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => (playlists ?? []).filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())), [playlists, filter]);

  return (
    <aside className={cn('flex h-full min-h-0 flex-col gap-2 transition-[width] duration-300', collapsed ? 'w-[76px]' : 'w-[264px] xl:w-[288px]')} aria-label="Main navigation">
      <nav className="rounded-[18px] bg-surface p-2">
        <div className={cn('mb-1 flex h-12 items-center px-3', collapsed ? 'justify-center px-0' : 'justify-between')}>
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2.5" aria-label="Aurora home">
              <Logo />
              <span className="font-display text-xl font-bold tracking-tight">Aurora</span>
            </Link>
          )}
          <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} size="sm" tooltipSide="right" disabled={narrow} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        </div>
        <ul className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(path, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? label : undefined}
                  className={cn(
                    'group flex h-10 items-center gap-3.5 rounded-xl px-3 text-[14px] font-semibold transition-colors',
                    collapsed && 'justify-center px-0',
                    active ? 'bg-active text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
                  )}
                >
                  <Icon className={cn('size-5 shrink-0 transition-transform group-active:scale-90', active && 'text-accent')} strokeWidth={active ? 2.4 : 2} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="flex min-h-0 flex-1 flex-col rounded-[18px] bg-surface p-2" aria-label="Your playlists">
        <div className={cn('flex h-11 items-center px-3', collapsed ? 'justify-center px-0' : 'justify-between')}>
          {!collapsed && <span className="text-[13px] font-semibold uppercase tracking-wider text-fg-3">Playlists</span>}
          <IconButton label="Create playlist" size="sm" tooltipSide="right" onClick={() => useUI.getState().openCreatePlaylist()}>
            <Plus />
          </IconButton>
        </div>
        {!collapsed && (playlists?.length ?? 0) > 8 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter playlists"
            aria-label="Filter playlists"
            className="mx-2 mb-2 h-8 rounded-lg bg-surface-2 px-3 text-[13px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-accent/40"
          />
        )}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
          <SideItem href="/liked" collapsed={collapsed} active={path === '/liked'} title="Liked Songs" subtitle="Playlist" playing={ctx?.type === 'liked' && playing}>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-accent">
              <Heart className="size-5 fill-[var(--accent-ink)] text-[var(--accent-ink)]" />
            </div>
          </SideItem>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                <Skeleton className="size-11" />
                {!collapsed && <Skeleton className="h-3 w-24" />}
              </div>
            ))}
          {shown.map((p) => (
            <SideItem
              key={p.id}
              href={`/playlist/${p.id}`}
              collapsed={collapsed}
              active={path === `/playlist/${p.id}`}
              title={p.name}
              subtitle={
                <>
                  {p.collaborative && <Users className="mr-1 inline size-3" />}
                  Playlist · {p.isOwner ? `${p.trackCount} songs` : p.ownerName}
                </>
              }
              playing={ctx?.type === 'playlist' && ctx.id === p.id && playing}
            >
              {p.cover ? <Artwork src={p.cover} alt="" className="size-11" rounded="md" kind="playlist" /> : <Mosaic covers={p.covers} alt="" className="size-11" rounded="md" seed={p.name} />}
            </SideItem>
          ))}
          {!isLoading && !playlists?.length && !collapsed && (
            <div className="m-2 rounded-xl bg-surface-2 p-4">
              <p className="text-sm font-semibold">Create your first playlist</p>
              <p className="mt-1 text-[13px] text-fg-2">It’s easy — we’ll help you.</p>
              <button onClick={() => useUI.getState().openCreatePlaylist()} className="mt-3 rounded-full bg-fg px-4 py-1.5 text-[13px] font-semibold text-bg transition hover:scale-[1.03] active:scale-95">
                Create playlist
              </button>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}

function SideItem({ href, collapsed, active, title, subtitle, children, playing }: { href: string; collapsed: boolean; active: boolean; title: string; subtitle: React.ReactNode; children: React.ReactNode; playing?: boolean }) {
  return (
    <Link
      href={href}
      title={collapsed ? title : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn('flex items-center gap-3 rounded-xl p-1.5 transition-colors', collapsed && 'justify-center', active ? 'bg-active' : 'hover:bg-hover')}
    >
      {children}
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-[14px] font-medium', playing && 'text-accent')}>{title}</div>
          <div className="truncate text-[12.5px] text-fg-2">{subtitle}</div>
        </div>
      )}
      {!collapsed && playing && <Volume2 className="mr-1 size-4 shrink-0 text-accent" />}
    </Link>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M7.5 21.5c2.6-6.6 5.2-10 8.5-10s5.9 3.4 8.5 10" fill="none" stroke="#111010" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="16" cy="21.5" r="2.4" fill="#111010" />
    </svg>
  );
}
