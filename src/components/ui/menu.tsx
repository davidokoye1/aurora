'use client';

import * as DM from '@radix-ui/react-dropdown-menu';
import * as CM from '@radix-ui/react-context-menu';
import { ChevronRight } from 'lucide-react';
import { cloneElement, isValidElement, useRef, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';
import { useActionSheet, type SheetHeader } from './sheet';
import { useMediaQuery } from '@/lib/client/hooks';

type Handlers = Record<string, ((e: React.SyntheticEvent) => void) | undefined>;
function withHandlers(node: ReactNode, add: Handlers): ReactNode {
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Handlers>;
  const merged: Handlers = {};
  for (const [k, fn] of Object.entries(add)) {
    const orig = el.props[k];
    merged[k] = (e) => {
      orig?.(e);
      fn?.(e);
    };
  }
  return cloneElement(el, merged);
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
  children?: MenuItem[];
  checked?: boolean;
}

const content = 'z-[80] min-w-[220px] max-w-[320px] animate-pop overflow-hidden rounded-xl border border-line bg-surface-2/95 p-1.5 text-sm shadow-float backdrop-blur-xl';
const item = 'flex h-9 cursor-default select-none items-center gap-3 rounded-lg px-2.5 text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-active [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-2';

function renderDM(items: MenuItem[]) {
  return items.map((it, i) =>
    it.separator ? (
      <DM.Separator key={i} className="my-1 h-px bg-line" />
    ) : it.children ? (
      <DM.Sub key={i}>
        <DM.SubTrigger className={item}>
          {it.icon}
          <span className="flex-1 truncate">{it.label}</span>
          <ChevronRight className="ml-auto" />
        </DM.SubTrigger>
        <DM.Portal>
          <DM.SubContent className={cn(content, 'max-h-[60vh] overflow-y-auto')} sideOffset={6}>
            {renderDM(it.children)}
          </DM.SubContent>
        </DM.Portal>
      </DM.Sub>
    ) : (
      <DM.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={cn(item, it.danger && 'text-danger [&_svg]:text-danger')}>
        {it.icon}
        <span className="flex-1 truncate">{it.label}</span>
        {it.checked && <span className="size-1.5 rounded-full bg-accent" />}
        {it.shortcut && <kbd className="text-xs text-fg-3">{it.shortcut}</kbd>}
      </DM.Item>
    ),
  );
}

function renderCM(items: MenuItem[]) {
  return items.map((it, i) =>
    it.separator ? (
      <CM.Separator key={i} className="my-1 h-px bg-line" />
    ) : it.children ? (
      <CM.Sub key={i}>
        <CM.SubTrigger className={item}>
          {it.icon}
          <span className="flex-1 truncate">{it.label}</span>
          <ChevronRight className="ml-auto" />
        </CM.SubTrigger>
        <CM.Portal>
          <CM.SubContent className={cn(content, 'max-h-[60vh] overflow-y-auto')} sideOffset={6}>
            {renderCM(it.children)}
          </CM.SubContent>
        </CM.Portal>
      </CM.Sub>
    ) : (
      <CM.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={cn(item, it.danger && 'text-danger [&_svg]:text-danger')}>
        {it.icon}
        <span className="flex-1 truncate">{it.label}</span>
        {it.shortcut && <kbd className="text-xs text-fg-3">{it.shortcut}</kbd>}
      </CM.Item>
    ),
  );
}

export function Menu({ trigger, items, align = 'end', side = 'bottom', onOpenChange, header }: { trigger: ReactNode; items: MenuItem[] | (() => MenuItem[]); align?: 'start' | 'end' | 'center'; side?: 'top' | 'bottom' | 'left' | 'right'; onOpenChange?: (o: boolean) => void; header?: SheetHeader | (() => SheetHeader) }) {
  const coarse = useMediaQuery('(pointer: coarse)');
  if (coarse) {
    return withHandlers(trigger, {
      onClick: (e) => {
        e.stopPropagation();
        e.preventDefault();
        useActionSheet.getState().open(typeof items === 'function' ? items() : items, typeof header === 'function' ? header() : header ?? null);
      },
    });
  }
  return (
    <DM.Root modal={false} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} side={side} sideOffset={6} collisionPadding={12} className={content} onCloseAutoFocus={(e) => e.preventDefault()}>
          {renderDM(typeof items === 'function' ? items() : items)}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Desktop: right-click menu. Touch: long-press (≈450ms) opens the action sheet. */
export function ContextMenu({ children, items, header }: { children: ReactNode; items: () => MenuItem[]; header?: () => SheetHeader }) {
  const coarse = useMediaQuery('(pointer: coarse)');
  const t = useRef<{ timer: number | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  if (coarse) {
    const cancel = () => {
      if (t.current.timer) clearTimeout(t.current.timer);
      t.current.timer = null;
    };
    return withHandlers(children, {
      onPointerDown: (e) => {
        const pe = e as React.PointerEvent;
        if (pe.pointerType !== 'touch') return;
        t.current = { timer: null, x: pe.clientX, y: pe.clientY, fired: false };
        t.current.timer = window.setTimeout(() => {
          t.current.fired = true;
          navigator.vibrate?.(10);
          useActionSheet.getState().open(items(), header?.() ?? null);
        }, 450);
      },
      onPointerMove: (e) => {
        const pe = e as React.PointerEvent;
        if (Math.abs(pe.clientX - t.current.x) > 8 || Math.abs(pe.clientY - t.current.y) > 8) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e) => e.preventDefault(),
      onClickCapture: (e) => {
        if (t.current.fired) {
          t.current.fired = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
    });
  }
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content collisionPadding={12} className={content}>
          {renderCM(items())}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
