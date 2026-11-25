import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { MobileTop } from './mobile-top';

/**
 * Standard page: on phones a large-title header (`MobileTop`), on desktop the floating top bar + title row.
 * `mobileRight` holds compact header actions for phones; `actions` render under the title on phones, beside it on desktop.
 */
export function Page({ children, className, title, subtitle, actions, mobileRight, back }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; mobileRight?: ReactNode; back?: boolean }) {
  const plain = typeof title === 'string' ? title : '';
  return (
    <div className="animate-fade-in">
      {title && <MobileTop title={plain || ' '} right={mobileRight} back={back} />}
      <div className={cn('px-4 md:px-8 md:pt-20', !title && 'pt-2', className)}>
        {title && (
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-6">
            <div className="hidden min-w-0 md:block">
              <h1 className="font-display text-5xl font-extrabold">{title}</h1>
              {subtitle && <p className="mt-2 text-sm text-fg-2">{subtitle}</p>}
            </div>
            {subtitle && <p className="-mt-1 text-sm text-fg-2 md:hidden">{subtitle}</p>}
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
