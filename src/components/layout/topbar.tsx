'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, Settings, User, EyeOff, Keyboard, BarChart3, Sparkles, Download, History, Server } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useMe, useSettings } from '@/lib/client/hooks';
import { api } from '@/lib/client/api';
import { Menu } from '@/components/ui/menu';
import { IconButton } from '@/components/ui/button';
import { useUI, toast } from '@/stores/ui';
import { cn } from '@/components/ui/cn';
import { Logo } from './sidebar';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function TopBar({ children, scrolled, tint }: { children?: ReactNode; scrolled: boolean; tint?: string | null }) {
  const router = useRouter();
  const me = useMe();
  const { settings, update } = useSettings();
  const [install, setInstall] = useState<BIPEvent | null>(null);
  useEffect(() => {
    const fn = (e: Event) => {
      e.preventDefault();
      setInstall(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', fn);
    return () => window.removeEventListener('beforeinstallprompt', fn);
  }, []);

  return (
    <header
      className={cn('sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 px-4 transition-[background,box-shadow] duration-300 md:px-6', scrolled && 'shadow-[0_1px_0_var(--border)]')}
      style={{ background: scrolled ? `color-mix(in srgb, ${tint ?? 'var(--surface)'} 55%, var(--surface))` : 'transparent' }}
    >
      <div className="flex items-center gap-2 max-md:hidden">
        <IconButton label="Go back" size="sm" className="bg-black/25" onClick={() => router.back()}>
          <ChevronLeft />
        </IconButton>
        <IconButton label="Go forward" size="sm" className="bg-black/25" onClick={() => router.forward()}>
          <ChevronRight />
        </IconButton>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      {settings.privateSession && (
        <button onClick={() => update({ privateSession: false })} className="hidden items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent sm:flex" title="Private session: listening isn’t recorded. Click to end.">
          <EyeOff className="size-3.5" /> Private session
        </button>
      )}
      {install && (
        <button
          onClick={async () => {
            await install.prompt();
            setInstall(null);
          }}
          className="hidden items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1.5 text-xs font-semibold text-fg transition hover:scale-105 sm:flex"
        >
          <Download className="size-3.5" /> Install app
        </button>
      )}
      <AccountMenu />
    </header>
  );
}


export function AccountMenu() {
  const router = useRouter();
  const me = useMe();
  const { settings, update } = useSettings();
  return (
    <Menu
        trigger={
          <button aria-label="Account menu" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/30 p-0.5 transition hover:scale-105">
            <span className="flex size-full items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">{me.name.slice(0, 1).toUpperCase()}</span>
          </button>
        }
        items={[
          { label: me.name, icon: <User />, onSelect: () => router.push('/settings#account') },
          { label: 'Downloads', icon: <Download />, onSelect: () => router.push('/downloads') },
          { label: 'Recently played', icon: <History />, onSelect: () => router.push('/history') },
          { label: 'Music sources', icon: <Server />, onSelect: () => router.push('/sources') },
          { label: 'Your stats', icon: <BarChart3 />, onSelect: () => router.push('/stats') },
          { label: `Your ${new Date().getFullYear()} recap`, icon: <Sparkles />, onSelect: () => router.push('/recap') },
          { label: settings.privateSession ? 'End private session' : 'Start private session', icon: <EyeOff />, onSelect: () => {
            update({ privateSession: !settings.privateSession });
            toast.info(settings.privateSession ? 'Private session ended.' : 'Private session on — your listening won’t be recorded or used for recommendations.');
          } },
          { label: 'Keyboard shortcuts', icon: <Keyboard />, shortcut: '?', onSelect: () => useUI.getState().setShortcuts(true) },
          { label: 'Settings', icon: <Settings />, onSelect: () => router.push('/settings') },
          { separator: true, label: '' },
          {
            label: 'Sign out',
            icon: <LogOut />,
            onSelect: async () => {
              await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
              localStorage.removeItem('aurora.player.v1');
              location.href = '/login';
            },
          },
        ]}
      />
  );
}

export function MobileHeader() {
  return (
    <div className="glass sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line px-4 md:hidden">
      <Link href="/" className="flex items-center gap-2" aria-label="Aurora home">
        <Logo className="size-7" />
        <span className="font-display text-lg font-bold">Aurora</span>
      </Link>
      <div className="flex items-center gap-1">
        <Link href="/downloads" aria-label="Downloads" className="rounded-full p-2 text-fg-2 hover:text-fg"><Download className="size-5" /></Link>
        <Link href="/history" aria-label="Recently played" className="rounded-full p-2 text-fg-2 hover:text-fg"><History className="size-5" /></Link>
        <AccountMenu />
      </div>
    </div>
  );
}
function MeInitial() {
  const me = useMe();
  return <>{me.name.slice(0, 1).toUpperCase()}</>;
}
