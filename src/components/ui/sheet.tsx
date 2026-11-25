'use client';

import { Drawer } from 'vaul';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { create } from 'zustand';
import type { MenuItem } from './menu';
import { cn } from './cn';

/** Generic bottom sheet (drag down to dismiss). */
export function Sheet({ open, onOpenChange, title, children, className, full }: { open: boolean; onOpenChange: (o: boolean) => void; title?: string; children: ReactNode; className?: string; full?: boolean }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[90] bg-[var(--scrim)]" />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-[91] flex flex-col rounded-t-[20px] border-t border-line bg-surface outline-none',
            full ? 'top-[max(env(safe-area-inset-top),16px)]' : 'max-h-[88dvh]',
            className,
          )}
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-1 mt-2.5 h-1 w-10 shrink-0 rounded-full bg-surface-3" aria-hidden />
          {title ? (
            <Drawer.Title className="px-5 pb-2 pt-2 font-display text-xl font-bold">{title}</Drawer.Title>
          ) : (
            <Drawer.Title className="sr-only">Options</Drawer.Title>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),12px)]">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export interface SheetHeader {
  art?: ReactNode;
  title: string;
  subtitle?: string;
}

/** Global action sheet: the phone version of every dropdown / context menu. */
export const useActionSheet = create<{ items: MenuItem[] | null; header: SheetHeader | null; open: (items: MenuItem[], header?: SheetHeader | null) => void; close: () => void }>((set) => ({
  items: null,
  header: null,
  open: (items, header = null) => set({ items, header }),
  close: () => set({ items: null }),
}));

export function ActionSheetHost() {
  const { items, header, close } = useActionSheet();
  const [stack, setStack] = useState<{ label: string; items: MenuItem[] }[]>([]);
  useEffect(() => {
    if (!items) setStack([]);
  }, [items]);
  const page = stack[stack.length - 1];
  const list = page?.items ?? items ?? [];
  return (
    <Sheet open={!!items} onOpenChange={(o) => !o && close()}>
      {page ? (
        <button onClick={() => setStack((s) => s.slice(0, -1))} className="flex h-12 w-full items-center gap-2 border-b border-line px-4 text-left text-[15px] font-semibold">
          <ChevronLeft className="size-5" /> {page.label}
        </button>
      ) : (
        header && (
          <div className="flex items-center gap-3 border-b border-line px-5 pb-4 pt-1">
            {header.art}
            <div className="min-w-0">
              <div className="truncate text-[16px] font-semibold">{header.title}</div>
              {header.subtitle && <div className="truncate text-[14px] text-fg-2">{header.subtitle}</div>}
            </div>
          </div>
        )
      )}
      <ul className="py-1.5" role="menu">
        {list.map((it, i) =>
          it.separator ? (
            <li key={i} className="mx-5 my-1.5 h-px bg-line" role="separator" />
          ) : (
            <li key={i}>
              <button
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  if (it.children) {
                    setStack((s) => [...s, { label: it.label, items: it.children! }]);
                    return;
                  }
                  close();
                  // let the sheet start closing before running the action (navigation, dialogs)
                  setTimeout(() => it.onSelect?.(), 60);
                }}
                className={cn(
                  'flex min-h-[52px] w-full items-center gap-4 px-5 text-left text-[16px] active:bg-active disabled:opacity-40 [&_svg]:size-[22px] [&_svg]:shrink-0',
                  it.danger ? 'text-danger [&_svg]:text-danger' : 'text-fg [&_svg]:text-fg-2',
                )}
              >
                {it.icon}
                <span className="flex-1 truncate">{it.label}</span>
                {it.checked && <Check className="!text-accent" />}
                {it.children && <ChevronRight className="!size-5" />}
              </button>
            </li>
          ),
        )}
      </ul>
    </Sheet>
  );
}
