'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search as SearchIcon, X, Clock, User, Disc3, Music2, Play } from 'lucide-react';
import { api } from '@/lib/client/api';
import { mixColor } from '@/lib/client/color';
import type { SearchResults } from '@/lib/server/search';
import { Page } from '@/components/layout/page';
import { MobileTop } from '@/components/layout/mobile-top';
import { useShell } from '@/components/layout/app-shell';
import { TrackList, TrackListSkeleton } from '@/components/media/track-list';
import { MediaCard, CardGrid, CardSkeletons, PlayFab } from '@/components/media/cards';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { Chip, EmptyState, ErrorState } from '@/components/ui/misc';
import { loadAlbum, loadArtist, loadPlaylist } from '@/lib/client/loaders';
import { usePlayer } from '@/stores/player';
import { cn } from '@/components/ui/cn';

type Filter = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'genres';

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function SearchBox({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  const debounced = useDebounced(value, 120);
  const { data: suggestions } = useQuery({ queryKey: ['suggest', debounced], queryFn: () => api<{ text: string; kind: string; id?: string }[]>(`/api/search/suggest?q=${encodeURIComponent(debounced)}`), enabled: focus, staleTime: 10_000 });
  const router = useRouter();
  const [active, setActive] = useState(-1);
  const list = suggestions ?? [];
  const go = (s: { text: string; kind: string; id?: string }) => {
    setFocus(false);
    if (s.kind === 'artist' && s.id) router.push(`/artist/${s.id}`);
    else if (s.kind === 'album' && s.id) router.push(`/album/${s.id}`);
    else {
      onChange(s.text);
      onSubmit(s.text);
    }
  };
  return (
    <div className="relative w-full max-w-[480px]">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-fg-2" />
      <input
        id="search-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(list.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === 'Enter') {
            if (active >= 0 && list[active]) go(list[active]);
            else {
              onSubmit(value);
              setFocus(false);
            }
          } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        placeholder="What do you want to listen to?"
        aria-label="Search"
        role="combobox"
        aria-expanded={focus && list.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        className="h-12 w-full rounded-full border border-transparent bg-surface-3 pl-12 pr-11 text-[15px] outline-none transition placeholder:text-fg-3 hover:border-line-strong focus:border-fg focus:bg-surface-2"
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-fg-2 hover:text-fg">
          <X className="size-5" />
        </button>
      )}
      {focus && list.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 top-14 z-30 animate-pop overflow-hidden rounded-2xl border border-line bg-surface-2/95 p-1.5 shadow-float backdrop-blur-xl">
          {list.map((s, i) => (
            <li key={s.kind + s.text + i} role="option" aria-selected={i === active}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => go(s)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm', i === active ? 'bg-active' : 'hover:bg-hover')}>
                {s.kind === 'history' ? <Clock className="size-4 text-fg-3" /> : s.kind === 'artist' ? <User className="size-4 text-fg-3" /> : s.kind === 'album' ? <Disc3 className="size-4 text-fg-3" /> : <Music2 className="size-4 text-fg-3" />}
                <span className="truncate">{s.text}</span>
                <span className="ml-auto text-xs capitalize text-fg-3">{s.kind === 'history' ? 'Recent' : s.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [filter, setFilter] = useState<Filter>((sp.get('f') as Filter) ?? 'all');
  const debounced = useDebounced(q.trim(), 220);
  const record = useRef(false);

  useEffect(() => {
    const url = new URL(location.href);
    if (debounced) url.searchParams.set('q', debounced);
    else url.searchParams.delete('q');
    if (filter !== 'all') url.searchParams.set('f', filter);
    else url.searchParams.delete('f');
    history.replaceState(null, '', url.toString());
  }, [debounced, filter]);

  const submit = (v: string) => {
    if (v.trim().length >= 2) void api('/api/search/history', { body: { query: v.trim() } }).then(() => qc.invalidateQueries({ queryKey: ['search-history'] }));
  };

  const header = useMemo(() => <SearchBox value={q} onChange={setQ} onSubmit={submit} />, [q]);
  useEffect(() => {
    useShell.getState().setHeader(header);
  }, [header]);
  useEffect(() => () => useShell.getState().setHeader(null), []);
  useEffect(() => {
    if (!sp.get('q')) document.querySelector<HTMLInputElement>('#search-input')?.focus();
  }, [sp]);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchResults>(`/api/search?q=${encodeURIComponent(debounced)}${record.current ? '&record=1' : ''}`),
    enabled: debounced.length > 0,
    placeholderData: (p) => p,
  });

  return (
    <>
    <MobileTop title="Search" />
    <Page>
      <div className="sticky top-[calc(env(safe-area-inset-top)+56px)] z-20 -mx-4 mb-4 bg-bg px-4 pb-3 md:hidden">
        <SearchBox value={q} onChange={setQ} onSubmit={submit} />
      </div>
      {!debounced ? (
        <Browse onPick={(v) => setQ(v)} />
      ) : error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : (
        <div className={cn('transition-opacity', isFetching && 'opacity-70')}>
          <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            {(['all', 'songs', 'artists', 'albums', 'playlists', 'genres'] as Filter[]).map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </Chip>
            ))}
          </div>
          {data?.didYouMean && (
            <p className="mb-5 text-sm text-fg-2">
              Did you mean{' '}
              <button className="font-semibold text-accent hover:underline" onClick={() => setQ(data.didYouMean!)}>
                {data.didYouMean}
              </button>
              ?
            </p>
          )}
          {data && (data.tracks.length || data.artists.length || data.albums.length || data.playlists.length || data.genres.length) ? (
            <Results data={data} filter={filter} onRecord={() => submit(debounced)} router={router} />
          ) : (
            data && !isFetching && <EmptyState icon={<SearchIcon />} title={`No results for “${data.query}”`} body="Check the spelling or try fewer words. Search covers song titles, artists, albums, genres and lyrics you’ve opened." />
          )}
        </div>
      )}
    </Page>
    </>
  );
}

function Results({ data, filter, onRecord }: { data: SearchResults; filter: Filter; onRecord: () => void; router: ReturnType<typeof useRouter> }) {
  const ctx = { type: 'search' as const, title: `Search: ${data.query}`, href: `/search?q=${encodeURIComponent(data.query)}` };
  const songs = (
    <TrackList rows={data.tracks.map((t) => ({ key: t.id, track: t }))} context={ctx} variant={filter === 'songs' ? 'search' : 'compact'} />
  );
  if (filter === 'songs') return data.tracks.length ? songs : <EmptyState title="No songs found" />;
  if (filter === 'artists')
    return (
      <CardGrid>
        {data.artists.map((a) => (
          <MediaCard key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle="Artist" cover={a.image} kind="artist" context={{ type: 'artist', id: a.id, title: a.name, href: `/artist/${a.id}` }} load={() => loadArtist(a.id)} />
        ))}
      </CardGrid>
    );
  if (filter === 'albums')
    return (
      <CardGrid>
        {data.albums.map((a) => (
          <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={[a.year, a.artist].filter(Boolean).join(' · ')} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />
        ))}
      </CardGrid>
    );
  if (filter === 'playlists')
    return data.playlists.length ? (
      <CardGrid>
        {data.playlists.map((p) => (
          <MediaCard key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={`By ${p.ownerName}`} cover={p.cover} covers={p.covers} kind="playlist" context={{ type: 'playlist', id: p.id, title: p.name, href: `/playlist/${p.id}` }} load={() => loadPlaylist(p.id)} />
        ))}
      </CardGrid>
    ) : (
      <EmptyState title="No playlists match" />
    );
  if (filter === 'genres') return <GenreTiles genres={data.genres} />;
  return (
    <div className="space-y-10" onClick={onRecord}>
      <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]', !data.top && !data.tracks.length && 'hidden')}>
        {data.top && (
          <section>
            <h2 className="mb-3 font-display text-[21px] font-extrabold md:text-2xl">Top result</h2>
            <TopResult top={data.top} ctx={ctx} />
          </section>
        )}
        {data.tracks.length > 0 && (
          <section className={cn(!data.top && 'lg:col-span-2')}>
            <h2 className="mb-3 font-display text-[21px] font-extrabold md:text-2xl">Songs</h2>
            <TrackList rows={data.tracks.slice(0, 5).map((t) => ({ key: t.id, track: t }))} context={ctx} variant="compact" />
          </section>
        )}
      </div>
      {data.artists.length > 0 && (
        <section>
          <h2 className="mb-3 px-2.5 font-display text-[21px] font-extrabold md:text-2xl">Artists</h2>
          <CardGrid>
            {data.artists.slice(0, 7).map((a) => (
              <MediaCard key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle="Artist" cover={a.image} kind="artist" context={{ type: 'artist', id: a.id, title: a.name, href: `/artist/${a.id}` }} load={() => loadArtist(a.id)} />
            ))}
          </CardGrid>
        </section>
      )}
      {data.albums.length > 0 && (
        <section>
          <h2 className="mb-3 px-2.5 font-display text-[21px] font-extrabold md:text-2xl">Albums</h2>
          <CardGrid>
            {data.albums.slice(0, 7).map((a) => (
              <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={[a.year, a.artist].filter(Boolean).join(' · ')} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />
            ))}
          </CardGrid>
        </section>
      )}
      {data.playlists.length > 0 && (
        <section>
          <h2 className="mb-3 px-2.5 font-display text-[21px] font-extrabold md:text-2xl">Playlists</h2>
          <CardGrid>
            {data.playlists.slice(0, 7).map((p) => (
              <MediaCard key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={`By ${p.ownerName}`} cover={p.cover} covers={p.covers} kind="playlist" context={{ type: 'playlist', id: p.id, title: p.name, href: `/playlist/${p.id}` }} load={() => loadPlaylist(p.id)} />
            ))}
          </CardGrid>
        </section>
      )}
      {data.genres.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[21px] font-extrabold md:text-2xl">Genres</h2>
          <GenreTiles genres={data.genres} />
        </section>
      )}
    </div>
  );
}

function TopResult({ top, ctx }: { top: NonNullable<SearchResults['top']>; ctx: { type: 'search'; title: string; href: string } }) {
  const href = top.kind === 'artist' ? `/artist/${top.item.id}` : top.kind === 'album' ? `/album/${top.item.id}` : top.item.albumId ? `/album/${top.item.albumId}?track=${top.item.id}` : '#';
  const title = top.kind === 'artist' ? top.item.name : top.item.title;
  const cover = top.kind === 'artist' ? top.item.image : top.item.cover;
  const sub = top.kind === 'artist' ? 'Artist' : top.kind === 'album' ? `Album · ${top.item.artist ?? ''}` : `Song · ${top.item.artist}`;
  return (
    <Link href={href} className="press group relative flex items-center gap-4 rounded-[14px] bg-surface-2 p-3 transition hover:bg-surface-3 md:block md:p-5">
      <Artwork src={cover} alt={title} className="size-16 md:size-24" rounded={top.kind === 'artist' ? 'full' : 'md'} kind={top.kind === 'track' ? 'track' : top.kind} seed={title} />
      <div className="min-w-0">
      <div className="truncate font-display text-[22px] font-extrabold md:mt-5 md:text-3xl">{title}</div>
      <div className="mt-0.5 text-sm text-fg-2 md:mt-1">{sub}</div>
      </div>
      <div className="absolute bottom-5 right-5 max-md:hidden translate-y-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
        {top.kind === 'track' ? (
          <button
            aria-label={`Play ${title}`}
            onClick={(e) => {
              e.preventDefault();
              usePlayer.getState().playTracks([top.item], { context: ctx });
            }}
            className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg"
          >
            <Play className="ml-0.5 size-5 fill-current" />
          </button>
        ) : (
          <PlayFab context={{ type: top.kind, id: top.item.id, title, href }} load={() => (top.kind === 'artist' ? loadArtist(top.item.id) : loadAlbum(top.item.id))} />
        )}
      </div>
    </Link>
  );
}

function GenreTiles({ genres }: { genres: { id: string; label: string; color: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {genres.map((g) => (
        <Link key={g.id} href={`/genre/${g.id}`} className="press relative block aspect-[16/9] overflow-hidden rounded-[10px] p-3.5 font-display text-xl font-extrabold text-[#111010] transition hover:scale-[1.02]" style={{ background: mixColor(g.id) }}>
          {g.label}
        </Link>
      ))}
    </div>
  );
}

function Browse({ onPick }: { onPick: (q: string) => void }) {
  const qc = useQueryClient();
  const { data: history } = useQuery({ queryKey: ['search-history'], queryFn: () => api<{ query: string }[]>('/api/search/history') });
  const { data: genres, isLoading } = useQuery({ queryKey: ['genres'], queryFn: () => api<{ families: { id: string; label: string; color: string; count: number }[] }>('/api/genres') });
  return (
    <div className="space-y-10">
      {history && history.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[21px] font-extrabold md:text-2xl">Recent searches</h2>
            <button className="text-[13px] font-semibold text-fg-2 hover:text-fg hover:underline" onClick={() => void api('/api/search/history', { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: ['search-history'] }))}>
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <span key={h.query} className="group inline-flex h-9 items-center gap-1 rounded-full bg-surface-2 pl-4 pr-1 text-sm">
                <button onClick={() => onPick(h.query)} className="hover:underline">{h.query}</button>
                <button aria-label={`Remove ${h.query}`} onClick={() => void api(`/api/search/history?q=${encodeURIComponent(h.query)}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: ['search-history'] }))} className="rounded-full p-1.5 text-fg-3 hover:text-fg">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-4 font-display text-[21px] font-extrabold md:text-2xl">Browse your library</h2>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><CardSkeletons n={5} /></div>
        ) : genres?.families.length ? (
          <GenreTiles genres={genres.families} />
        ) : (
          <p className="text-sm text-fg-2">Nothing in your library yet. <Link href="/setup" className="font-semibold text-accent">Add your music</Link> and it’ll be searchable here.</p>
        )}
      </section>
      <section>
        <h2 className="mb-4 font-display text-[21px] font-extrabold md:text-2xl">Quick picks</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BrowseTile href="/liked" title="Liked Songs" />
          <BrowseTile href="/mix/recent" title="Recently Added" />
          <BrowseTile href="/history" title="Recently Played" />
          <BrowseTile href="/discover" title="Make a mix with AI" />
        </div>
      </section>
    </div>
  );
}

function BrowseTile({ href, title }: { href: string; title: string }) {
  return (
    <Link href={href} className="flex h-16 items-center gap-3 rounded-xl bg-surface-2 px-4 font-semibold transition hover:bg-surface-3">
      <Mosaic covers={[]} alt="" className="size-10" seed={title} />
      {title}
    </Link>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  );
}
