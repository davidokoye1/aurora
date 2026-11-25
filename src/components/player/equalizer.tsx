'use client';

import { useEffect, useRef, useState } from 'react';
import { EQ_FREQS, EQ_PRESETS, getEngine } from '@/lib/client/audio-engine';
import { useSettings } from '@/lib/client/hooks';
import { Switch, Chip } from '@/components/ui/misc';
import { cn } from '@/components/ui/cn';

const label = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

export function EqualizerPanel({ dark }: { dark?: boolean }) {
  const { settings, update } = useSettings();
  const [bands, setBands] = useState(settings.eqBands);
  const timer = useRef<number | null>(null);
  useEffect(() => setBands(settings.eqBands), [settings.eqBands]);

  const apply = (b: number[], preset: string) => {
    setBands(b);
    getEngine().setOptions({ eqBands: b, eqEnabled: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => update({ eqBands: b, eqPreset: preset, eqEnabled: true }), 400);
  };

  return (
    <div className="space-y-5 p-4">
      <div className={cn('flex items-center justify-between rounded-xl p-3', dark ? 'bg-white/10' : 'bg-surface-2')}>
        <div>
          <div className="text-sm font-semibold">Equalizer</div>
          <div className={cn('text-xs', dark ? 'text-white/60' : 'text-fg-2')}>Shape the sound with a 10-band EQ.</div>
        </div>
        <Switch
          checked={settings.eqEnabled}
          onChange={(v) => {
            getEngine().setOptions({ eqEnabled: v });
            update({ eqEnabled: v });
          }}
          label="Enable equalizer"
        />
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {Object.entries(EQ_PRESETS).map(([id, p]) => (
          <Chip key={id} active={settings.eqEnabled && settings.eqPreset === id} onClick={() => apply(p.bands, id)}>
            {p.label}
          </Chip>
        ))}
      </div>
      <div className={cn('flex h-56 items-stretch justify-between gap-1 rounded-xl p-3', dark ? 'bg-white/5' : 'bg-surface-2', !settings.eqEnabled && 'opacity-50')}>
        {EQ_FREQS.map((f, i) => (
          <div key={f} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-[10px] tabular-nums opacity-70">{bands[i] > 0 ? '+' : ''}{bands[i]}</span>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={bands[i]}
              aria-label={`${label(f)} Hz`}
              onChange={(e) => {
                const b = [...bands];
                b[i] = Number(e.target.value);
                apply(b, 'custom');
              }}
              className="slider flex-1 [direction:rtl] [writing-mode:vertical-lr]"
              style={{ ['--pct' as string]: `${((bands[i] + 12) / 24) * 100}%` }}
            />
            <span className="text-[10px] font-semibold opacity-70">{label(f)}</span>
          </div>
        ))}
      </div>
      <div className={cn('flex items-center justify-between rounded-xl p-3', dark ? 'bg-white/10' : 'bg-surface-2')}>
        <div>
          <div className="text-sm font-semibold">Normalize volume</div>
          <div className={cn('text-xs', dark ? 'text-white/60' : 'text-fg-2')}>Uses ReplayGain tags or measured loudness to even out levels.</div>
        </div>
        <Switch
          checked={settings.normalize}
          onChange={(v) => {
            getEngine().setOptions({ normalize: v });
            update({ normalize: v });
          }}
          label="Normalize volume"
        />
      </div>
    </div>
  );
}
