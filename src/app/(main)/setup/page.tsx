'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Smartphone, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Play } from 'lucide-react';
import { api } from '@/lib/client/api';
import { plural } from '@/lib/client/format';
import { useMe } from '@/lib/client/hooks';
import type { SourceDTO } from '@/lib/types';
import { useSyncLive } from '@/stores/sync';
import { Page } from '@/components/layout/page';
import { FolderPicker } from '@/components/sources/folder-picker';
import { UploadZone } from '@/components/sources/upload-zone';
import { cn } from '@/components/ui/cn';

type Step = 'choose' | 'folder' | 'upload';

export default function SetupPage() {
  return (
    <Suspense>
      <Setup />
    </Suspense>
  );
}

function Setup() {
  const me = useMe();
  const sp = useSearchParams();
  const [step, setStep] = useState<Step>(sp.get('step') === 'upload' || !me.isAdmin ? 'upload' : sp.get('step') === 'folder' ? 'folder' : 'choose');
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: () => api<SourceDTO[]>('/api/sources'), refetchInterval: 5000 });
  const live = useSyncLive((s) => s.live);
  const mine = (sources ?? []).filter((s) => s.type === 'folder' || (s.type === 'upload' && s.trackCount > 0));
  const total = mine.reduce((a, s) => a + s.trackCount, 0);

  return (
    <Page title="Add your music" subtitle="Aurora plays the music you already own. Choose where it lives — you can add more places any time." back>
      <div className="mx-auto max-w-2xl space-y-6 pb-10">
        {step === 'choose' && (
          <div className="space-y-2.5">
            <Choice icon={<FolderOpen />} title="Folders on this computer or a drive" body="Your Music folder, Downloads, or an external drive / USB stick. New songs you add there appear on their own." onClick={() => setStep('folder')} primary />
            <Choice icon={<Smartphone />} title="Songs on this phone" body="Upload music files from your phone (or this device) to the computer running Aurora." onClick={() => setStep('upload')} />
          </div>
        )}

        {step === 'folder' && (
          <section className="rounded-[18px] bg-surface p-3 md:p-5">
            <StepHeader title="Choose a music folder" onBack={me.isAdmin ? () => setStep('choose') : undefined} />
            <FolderPicker />
          </section>
        )}

        {step === 'upload' && (
          <section className="rounded-[18px] bg-surface p-4 md:p-5">
            <StepHeader title="Upload from this device" onBack={me.isAdmin ? () => setStep('choose') : undefined} />
            <UploadZone />
          </section>
        )}

        {mine.length > 0 && (
          <section aria-label="Your music so far">
            <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-[0.12em] text-fg-2">Your music so far</h2>
            <ul className="overflow-hidden rounded-[16px] bg-surface">
              {mine.map((s) => {
                const p = live[s.id] ?? s.job;
                const running = p?.status === 'running' || s.status === 'syncing';
                return (
                  <li key={s.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', s.status === 'offline' ? 'bg-warning/15 text-warning' : 'bg-accent/15 text-accent')}>
                      {running ? <Loader2 className="size-4 animate-spin" /> : s.status === 'offline' ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{s.type === 'upload' ? 'Uploaded songs' : s.name}</div>
                      <div className="truncate text-[13px] text-fg-2">
                        {running && p ? `Scanning… ${plural(p.imported, 'song')} added` : s.status === 'offline' ? 'Drive not connected — plug it in and it reconnects' : plural(s.trackCount, 'song')}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {step !== 'choose' && me.isAdmin && (
              <button className="mt-2 flex items-center gap-1 px-1 text-sm font-semibold text-accent" onClick={() => setStep('choose')}>
                Add another place <ChevronRight className="size-4" />
              </button>
            )}
          </section>
        )}

        {total > 0 && (
          <Link href="/" className="press flex h-14 items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-accent-ink">
            <Play className="size-5 fill-current" /> Start listening · {plural(total, 'song')}
          </Link>
        )}
      </div>
    </Page>
  );
}

function StepHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 px-1">
      <h2 className="font-display text-[19px] font-bold">{title}</h2>
      {onBack && (
        <button className="text-[13px] font-semibold text-fg-2 hover:text-fg" onClick={onBack}>
          Other options
        </button>
      )}
    </div>
  );
}

function Choice({ icon, title, body, onClick, primary }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className={cn('press flex w-full items-center gap-4 rounded-[18px] border p-4 text-left md:p-5', primary ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface')}>
      <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-[14px] [&_svg]:size-6', primary ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-fg')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[13.5px] text-fg-2">{body}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-fg-3" />
    </button>
  );
}
