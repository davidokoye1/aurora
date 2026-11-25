'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />;
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex animate-rise flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-surface-2 text-fg-2 [&_svg]:size-7">{icon}</div>}
      <h3 className="font-display text-2xl font-bold tracking-tight">{title}</h3>
      {body && <div className="mt-2 max-w-md text-sm leading-relaxed text-fg-2">{body}</div>}
      {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry, className }: { error: unknown; retry?: () => void; className?: string }) {
  const msg = (error as Error)?.message ?? 'Something went wrong.';
  return (
    <EmptyState
      className={className}
      icon={<AlertTriangle />}
      title="Couldn’t load this"
      body={msg}
      action={retry && <Button onClick={retry} icon={<RefreshCw className="size-4" />}>Try again</Button>}
    />
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-accent' : 'bg-surface-3')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-all active:scale-95',
        active ? 'bg-fg text-bg' : 'bg-surface-2 text-fg hover:bg-surface-3',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('no-scrollbar flex gap-2 overflow-x-auto', className)}>
      {options.map((o) => (
        <Chip key={o.value} active={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="ml-1.5 opacity-60">{o.count.toLocaleString()}</span>}
        </Chip>
      ))}
    </div>
  );
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cn(
        'h-12 w-full rounded-xl border border-line bg-surface-2 px-4 text-[15px] text-fg outline-none md:h-11 md:text-sm transition placeholder:text-fg-3 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={cn('min-h-24 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:ring-4 focus:ring-accent/15', className)}
    />
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-fg-2">
      {children}
      {hint && <span className="ml-2 font-normal text-fg-3">{hint}</span>}
    </label>
  );
}

/** Animated equaliser bars for the now-playing row. */
export function PlayingBars({ paused, className }: { paused?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex h-3.5 items-end gap-[2px]', className)} aria-label="Now playing">
      {[0, 0.2, 0.4, 0.1].map((d, i) => (
        <span key={i} className="eq-bar w-[3px] rounded-sm bg-accent" style={{ animationDelay: `${d}s`, animationPlayState: paused ? 'paused' : 'running', height: '100%' }} />
      ))}
    </span>
  );
}

/** Shows children once scrolled into view (cheap lazy sections). */
export function InView({ children, className, minHeight = 200 }: { children: ReactNode; className?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShow(true), { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={!show ? { minHeight } : undefined}>
      {show && children}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="truncate font-display text-[22px] font-bold tracking-tight md:text-2xl">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-sm text-fg-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
