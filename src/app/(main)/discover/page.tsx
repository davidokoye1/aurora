'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Wand2, Save, Play, Shuffle, Radio } from 'lucide-react';
import { api } from '@/lib/client/api';
import { mixColor } from '@/lib/client/color';
import { fmtDuration } from '@/lib/client/format';
import type { HomeData } from '@/lib/server/home';
import type { Playlist, Track } from '@/lib/types';
import { Page } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Chip, EmptyState } from '@/components/ui/misc';
import { TrackList, TrackListSkeleton } from '@/components/media/track-list';
import { MediaCard, Shelf } from '@/components/media/cards';
import { MoodTile } from '@/components/media/mood-tile';
import { usePlayer } from '@/stores/player';
import { toast } from '@/stores/ui';
import { loadRadio } from '@/lib/client/loaders';
import { cn } from '@/components/ui/cn';

const EXAMPLES = ['A late-night drive', 'Focus music for deep work, no vocals', 'Upbeat songs for a morning run', 'Rainy Sunday, slow and cozy', 'Party starter — 1 hour', 'Something like Neon Harbor', '90s throwbacks', 'Chill but not sleepy, no rap'];

interface NL {
  title: string;
  description: string;
  chips: { kind: string; label: string }[];
  tracks: Track[];
}

export default function DiscoverPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<NL | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: moods } = useQuery({ queryKey: ['moods'], queryFn: () => api<{ id: string; label: string; blurb: string; gradient: [string, string]; covers: string[]; available: number }[]>('/api/moods'), staleTime: 5 * 60_000 });
  const { data: genres } = useQuery({ queryKey: ['genres'], queryFn: () => api<{ families: { id: string; label: string; color: string; count: number }[] }>('/api/genres') });
  const { data: home } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home'), staleTime: 60_000 });

  const generate = async (p = prompt) => {
    if (!p.trim()) return;
    setPrompt(p);
    setBusy(true);
    try {
      setResult(await api<NL>('/api/recs/nl', { body: { prompt: p } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!result) return;
    const pl = await api<Playlist>('/api/playlists', { body: { name: result.title, description: result.description, trackIds: result.tracks.map((t) => t.id) } });
    void qc.invalidateQueries({ queryKey: ['playlists'] });
    toast.success(`Saved “${pl.name}”`);
    router.push(`/playlist/${pl.id}`);
  };
  const total = result?.tracks.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  const ctx = { type: 'mix' as const, id: 'nl', title: result?.title ?? 'AI mix' };

  return (
    <Page back title="Discover" subtitle="Describe a moment, pick a mood, or start a station — all from your own library." className="space-y-12">
      <section className="relative overflow-hidden rounded-[26px] border border-line bg-surface-2 p-6 md:p-8">
                        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            <Wand2 className="size-4" /> Mix generator
          </div>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">What are you in the mood for?</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
            className="mt-5 flex flex-col gap-3 sm:flex-row"
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. “Make me a playlist for a late-night drive”"
              aria-label="Describe your playlist"
              maxLength={300}
              className="h-14 flex-1 rounded-2xl border border-line bg-surface px-5 text-[15px] outline-none transition placeholder:text-fg-3 focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
            <Button type="submit" variant="primary" size="lg" className="h-14" loading={busy} icon={<Sparkles className="size-4" />} disabled={!prompt.trim()}>
              Generate
            </Button>
          </form>
          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
            {EXAMPLES.map((e) => (
              <Chip key={e} onClick={() => void generate(e)}>
                {e}
              </Chip>
            ))}
          </div>
        </div>
        {(busy || result) && (
          <div className="relative mt-8 animate-rise rounded-[20px] bg-surface p-4 md:p-6">
            {busy && !result ? (
              <TrackListSkeleton rows={5} />
            ) : result && result.tracks.length ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-display text-2xl font-bold">{result.title}</h3>
                    <p className="mt-1 text-sm text-fg-2">
                      {result.tracks.length} songs · {fmtDuration(total)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {result.chips.map((c, i) => (
                        <span key={i} className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', c.kind === 'exclude' ? 'bg-danger/12 text-danger' : c.kind === 'taste' ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-fg')}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" icon={<Play className="size-4 fill-current" />} onClick={() => usePlayer.getState().playTracks(result.tracks, { context: ctx, shuffle: false })}>
                      Play
                    </Button>
                    <Button icon={<Shuffle className="size-4" />} onClick={() => usePlayer.getState().playTracks(result.tracks, { context: ctx, shuffle: true })}>
                      Shuffle
                    </Button>
                    <Button icon={<Save className="size-4" />} onClick={() => void save()}>
                      Save as playlist
                    </Button>
                    <Button variant="ghost" onClick={() => void generate()} loading={busy}>
                      Regenerate
                    </Button>
                  </div>
                </div>
                <div className="mt-5 max-h-[520px] overflow-y-auto">
                  <TrackList rows={result.tracks.map((t, i) => ({ key: `${t.id}:${i}`, track: t }))} context={ctx} variant="compact" />
                </div>
              </>
            ) : (
              <EmptyState title="Nothing in your library fits that yet" body="Try different words, or add more music to your sources." className="py-8" />
            )}
          </div>
        )}
      </section>

      {home && home.mixes.length > 0 && (
        <Shelf title="Your daily mixes">
          {home.mixes.map((m) => (
            <MediaCard key={m.id} href={`/mix/${m.id}`} title={m.title} subtitle={m.subtitle} covers={m.covers} color={m.color} kind="mix" context={{ type: 'mix', id: m.id, title: m.title, href: `/mix/${m.id}` }} load={() => m.tracks} />
          ))}
          {home.discover.map((m) => (
            <MediaCard key={m.id} href={`/mix/${m.id}`} title={m.title} subtitle={m.subtitle} covers={m.covers} color={m.color} kind="mix" context={{ type: 'mix', id: m.id, title: m.title, href: `/mix/${m.id}` }} load={() => m.tracks} />
          ))}
        </Shelf>
      )}

      {moods && moods.some((m) => m.available >= 5) && (
        <section>
          <h2 className="mb-4 font-display text-2xl font-bold">Moods & activities</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {moods.filter((m) => m.available >= 5).map((m) => (
              <MoodTile key={m.id} mood={m} />
            ))}
          </div>
        </section>
      )}

      {home && home.artists.length > 0 && (
        <Shelf title="Artist radio" subtitle="Endless stations built around artists you love">
          {home.artists.slice(0, 12).map((a) => (
            <MediaCard
              key={a.id}
              href={`/radio?artist=${a.id}`}
              title={`${a.name} Radio`}
              subtitle={<span className="inline-flex items-center gap-1"><Radio className="size-3" /> Station</span>}
              cover={a.image}
              kind="artist"
              context={{ type: 'radio', id: a.id, title: `${a.name} Radio`, href: `/radio?artist=${a.id}` }}
              load={() => loadRadio({ artist: a.id })}
            />
          ))}
        </Shelf>
      )}

      {genres && genres.families.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-2xl font-bold">Genres in your library</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {genres.families.map((g) => (
              <Link key={g.id} href={`/genre/${g.id}`} className="relative block aspect-[16/10] overflow-hidden rounded-[14px] p-4 transition hover:scale-[1.02]" style={{ background: mixColor(g.id) }}>
                <div className="font-display text-xl font-extrabold text-[#111010]">{g.label}</div>
                <div className="text-xs text-[#111010]/70">{g.count} songs</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
