'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Users, ListMusic } from 'lucide-react';
import type { Playlist, Track } from '@/lib/types';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { fmtTime, plural } from '@/lib/client/format';
import { Logo } from '@/components/layout/sidebar';

interface Data {
  playlist: Playlist;
  tracks: Track[];
  kind: 'view' | 'collab';
  signedIn: boolean;
  isMember: boolean;
}

export function ShareView({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then(async (r) => (r.ok ? setData(await r.json()) : setErr((await r.json()).error ?? 'Link not found')))
      .catch(() => setErr('Network error'));
  }, [token]);
  const join = async () => {
    setJoining(true);
    const r = await fetch(`/api/share/${token}/join`, { method: 'POST' });
    if (r.ok) location.href = `/playlist/${(await r.json()).playlistId}`;
    else setJoining(false);
  };
  const p = data?.playlist;
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-16 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5"><Logo /><span className="font-display text-xl font-bold">Aurora</span></Link>
        {!data?.signedIn && <Link href={`/login?next=/share/${token}`} className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg">Sign in</Link>}
      </header>
      <main className="mx-auto max-w-4xl px-6 pb-20 pt-6">
        {err ? (
          <div className="py-24 text-center">
            <ListMusic className="mx-auto size-10 text-fg-3" />
            <h1 className="mt-4 font-display text-3xl font-bold">{err}</h1>
            <p className="mt-2 text-fg-2">Ask the owner for a new link.</p>
          </div>
        ) : !p ? (
          <div className="skeleton mx-auto mt-10 h-60 w-60 rounded-2xl" />
        ) : (
          <>
            <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
              <div className="w-52 shrink-0 shadow-float">
                {p.cover ? <Artwork src={p.cover} alt="" className="aspect-square w-full" rounded="lg" /> : <Mosaic covers={p.covers} alt="" className="aspect-square w-full" rounded="lg" seed={p.name} />}
              </div>
              <div className="text-center md:text-left">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-2">{data.kind === 'collab' ? 'Invitation to collaborate' : 'Shared playlist'}</div>
                <h1 className="mt-2 font-display text-5xl font-bold tracking-tight">{p.name}</h1>
                {p.description && <p className="mt-2 text-fg-2">{p.description}</p>}
                <p className="mt-2 text-sm text-fg-2">By {p.ownerName} · {plural(data.tracks.length, 'song')}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-3 md:justify-start">
                  {data.signedIn ? (
                    <>
                      <Link href={`/playlist/${p.id}`} className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink">Open in Aurora</Link>
                      {data.kind === 'collab' && !data.isMember && (
                        <button onClick={join} disabled={joining} className="inline-flex items-center gap-2 rounded-full bg-surface-3 px-6 py-3 text-sm font-semibold"><Users className="size-4" /> {joining ? 'Joining…' : 'Join as collaborator'}</button>
                      )}
                    </>
                  ) : (
                    <Link href={`/login?next=/share/${token}`} className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink">Sign in to listen</Link>
                  )}
                </div>
              </div>
            </div>
            <ol className="mt-10 divide-y divide-line">
              {data.tracks.map((t, i) => (
                <li key={t.id + i} className="flex items-center gap-4 py-2.5">
                  <span className="w-6 text-right text-sm tabular-nums text-fg-3">{i + 1}</span>
                  <Artwork src={t.cover} alt="" className="size-10" rounded="sm" seed={t.album ?? t.title} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.title}</div>
                    <div className="truncate text-sm text-fg-2">{t.artist}</div>
                  </div>
                  <span className="text-sm tabular-nums text-fg-2">{fmtTime(t.duration)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
