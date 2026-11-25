'use client';

import { useState } from 'react';
import { cn } from '@/components/ui/cn';

/**
 * Single-series column chart: one hue (accent), thin rounded columns anchored to the baseline,
 * 2px gaps, recessive axis, hover tooltip, and a screen-reader table.
 */
export function ColumnChart({ data, labels, format, height = 140, title, tickEvery = 1 }: { data: number[]; labels: string[]; format: (v: number) => string; height?: number; title: string; tickEvery?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data);
  const peak = data.indexOf(Math.max(...data));
  return (
    <figure className="relative">
      <div className="relative flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((v, i) => (
          <div key={i} className="relative flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${labels[i]}: ${format(v)}`}>
            <div
              className={cn('w-full rounded-t-[4px] transition-opacity', hover !== null && hover !== i ? 'opacity-45' : 'opacity-100')}
              style={{ height: `${Math.max(v > 0 ? 3 : 1, (v / max) * 100)}%`, background: v > 0 ? 'var(--accent)' : 'var(--surface-3)' }}
            />
          </div>
        ))}
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-surface-3 px-2.5 py-1.5 text-xs shadow-float" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}>
            <div className="font-semibold text-fg">{format(data[hover])}</div>
            <div className="text-fg-2">{labels[hover]}</div>
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-[2px] border-t border-line pt-1.5 text-[10px] text-fg-3">
        {labels.map((l, i) => (
          <span key={i} className={cn('flex-1 text-center', i % tickEvery !== 0 && 'invisible', i === peak && data[peak] > 0 && 'font-semibold text-fg-2')}>
            {l}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((v, i) => (
            <tr key={i}>
              <th scope="row">{labels[i]}</th>
              <td>{format(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Ranked horizontal bars (single hue); labels and values in text tokens. */
export function RankBars({ rows, format }: { rows: { label: string; value: number; href?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="text-right tabular-nums text-fg-3">{i + 1}</span>
          <div className="min-w-0">
            <div className="mb-1 truncate font-medium text-fg">{r.label}</div>
            <div className="h-2 rounded-r-[4px] bg-surface-3">
              <div className="h-full rounded-r-[4px] bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
          <span className="tabular-nums text-fg-2">{format(r.value)}</span>
        </li>
      ))}
    </ol>
  );
}
