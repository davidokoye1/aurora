'use client';

import * as Tooltip from '@radix-ui/react-tooltip';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-3 text-fg hover:bg-active',
  ghost: 'text-fg-2 hover:text-fg hover:bg-hover',
  outline: 'border border-line-strong text-fg hover:border-fg-2 hover:bg-hover',
  danger: 'bg-danger/90 text-white hover:bg-danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
          size === 'sm' && 'h-8 px-3.5 text-[13px]',
          size === 'md' && 'h-10 px-5 text-sm',
          size === 'lg' && 'h-12 px-7 text-[15px]',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Spinner className="size-4" /> : icon}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl'; tooltip?: boolean; tooltipSide?: 'top' | 'bottom' | 'left' | 'right' }
>(function IconButton({ label, active, size = 'md', className, children, tooltip = true, tooltipSide = 'top', ...rest }, ref) {
  const btn = (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full transition-all duration-150 active:scale-90 disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'size-8 [&_svg]:size-4',
        size === 'md' && 'size-9 [&_svg]:size-[18px]',
        size === 'lg' && 'size-11 [&_svg]:size-5',
        size === 'xl' && 'size-14 [&_svg]:size-6',
        active ? 'text-accent' : 'text-fg-2 hover:text-fg',
        'hover:bg-hover',
        className,
      )}
      {...rest}
    >
      {children}
      {active && <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip.Root delayDuration={450}>
      <Tooltip.Trigger asChild>{btn}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={tooltipSide} sideOffset={6} className="z-[100] animate-fade-in rounded-md bg-surface-3 px-2.5 py-1 text-xs font-medium text-fg shadow-float">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-[spin_0.8s_linear_infinite]', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Tip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root delayDuration={450}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="z-[100] max-w-xs animate-fade-in rounded-md bg-surface-3 px-2.5 py-1 text-xs font-medium text-fg shadow-float">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
