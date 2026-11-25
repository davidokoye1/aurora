'use client';

import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export function Dialog({ open, onOpenChange, title, description, children, className, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children?: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[90] animate-fade-in bg-[var(--scrim)] backdrop-blur-sm" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[91] max-h-[88vh] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 animate-pop overflow-y-auto rounded-[22px] border border-line bg-surface p-6 shadow-float outline-none',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="font-display text-2xl font-bold tracking-tight">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-fg-2">{description}</D.Description>}
            </div>
            <D.Close className="-mr-2 -mt-1 rounded-full p-2 text-fg-2 transition hover:bg-hover hover:text-fg" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          {children}
          {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
