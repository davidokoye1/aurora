'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useMe } from '@/lib/client/hooks';
import { cn } from '@/components/ui/cn';

/**
 * Phone header. Root tabs show a large title that collapses into a compact sticky bar on scroll;
 * detail pages pass `back` and usually `overlay` (transparent bar over artwork until scrolled).
 */
export function MobileTop({ title, right, back, overlay, large = !back, avatar = !back }: { title: string; right?: ReactNode; back?: boolean; overlay?: boolean; large?: boolean; avatar?: boolean }) {
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    const root = document.getElementById('main-scroll');
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { root, threshold: 0, rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="md:hidden">
      <div
        className={cn(
          'safe-top fixed inset-x-0 top-0 z-30 transition-[background-color,border-color] duration-200',
          compact || !overlay ? 'border-b bg-bg' : 'border-b border-transparent bg-transparent',
          compact ? 'border-line' : 'border-transparent',
        )}
      >
        <div className="relative flex h-14 items-center gap-1 px-2">
          {back ? (
            <button onClick={() => router.back()} aria-label="Back" className={cn('press flex size-11 items-center justify-center rounded-full', overlay && !compact && 'bg-black/35 text-white')}>
              <ChevronLeft className="size-6" />
            </button>
          ) : avatar ? (
            <AvatarLink />
          ) : (
            <span className="w-2" />
          )}
          <div className={cn('pointer-events-none absolute inset-x-16 truncate text-center text-[16px] font-semibold transition-opacity duration-200', compact || (!large && !overlay) ? 'opacity-100' : 'opacity-0')}>{title}</div>
          <div className="ml-auto flex items-center gap-0.5">{right}</div>
        </div>
      </div>
      <div className="safe-top" aria-hidden>
        <div className="h-14" />
      </div>
      {large && <h1 className="px-4 pb-3 pt-1 font-display text-[32px] font-extrabold leading-[1.05]">{title}</h1>}
      <div ref={sentinel} className="h-px" aria-hidden />
    </div>
  );
}

function AvatarLink() {
  const me = useMe();
  return (
    <Link href="/settings" aria-label="Profile and settings" className="press ml-1 flex size-9 items-center justify-center rounded-full bg-accent text-[15px] font-bold text-accent-ink">
      {me.name.slice(0, 1).toUpperCase()}
    </Link>
  );
}

/** Round icon button used in phone headers (44px target). */
export function TopIcon({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: ReactNode }) {
  const cls = 'press flex size-11 items-center justify-center rounded-full text-fg [&_svg]:size-[22px]';
  return href ? (
    <Link href={href} aria-label={label} className={cls}>
      {children}
    </Link>
  ) : (
    <button onClick={onClick} aria-label={label} className={cls}>
      {children}
    </button>
  );
}
