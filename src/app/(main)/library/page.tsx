'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Plus, LayoutGrid, List, Search, FolderPlus, Library as LibraryIcon, Podcast, Folder, Trash2, ListPlus, Wand2, Download, History, Server } from 'lucide-react';
import { api } from '@/lib/client/api';
import { plural } from '@/lib/client/format';
import { usePlaylists, useMounted, useMediaQuery } from '@/lib/client/hooks';
import { TopIcon } from '@/components/layout/mobile-top';
import type { Album, Artist, Track } from '@/lib/types';
import { Page } from '@/components/layout/page';
import { MediaCard, CardGrid, CardSkeletons } from '@/components/media/cards';
import { TrackList, TrackListSkeleton } from '@/components/media/track-list';
import { Artwork, Mosaic } from '@/components/ui/artwork';
import { Button, IconButton } from '@/components/ui/button';
import { Chip, EmptyState, Tabs } from '@/components/ui/misc';
import { Menu } from '@/components/ui/menu';
import { useUI, toast, confirmDialog } from '@/stores/ui';
import { loadAlbum, loadArtist, loadPlaylist } from '@/lib/client/loaders';
import { cn } from '@/components/ui/cn';

type Tab = 'playlists' | 'albums' | 'artists' | 'songs' | 'podcasts' | 'collections';

function LibraryInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>((sp.get('tab') as Tab) ?? 'playlists');
  const [q, setQ] = useState('');
  const touch = useMediaQuery('(pointer: coarse)');
  const [viewPref, setView] = useState<'grid' | 'list' | null>(null);
  const view = viewPref ?? (touch ? 'list' : 'grid');
  const [savedOnly, setSavedOnly] = useState(false);
  const [sort, setSort] = useState(sp.get('sort') ?? 'recent');
  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/library?tab=${t}`, { scroll: false });
  };
  const addRef = sp.get('add');
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <Page
      title="Your Library"
      mobileRight={
        <>
          <TopIcon label="Search your library" onClick={() => setSearchOpen((v) => !v)}><Search /></TopIcon>
          <Menu
            header={{ title: 'Add to your library' }}
            trigger={<span><TopIcon label="Create or add"><Plus /></TopIcon></span>}
            items={[
              { label: 'New playlist', icon: <ListPlus />, onSelect: () => useUI.getState().openCreatePlaylist() },
              { label: 'Make a mix from a prompt', icon: <Wand2 />, onSelect: () => router.push('/discover') },
              { label: 'Add music (upload or URL)', icon: <FolderPlus />, onSelect: () => router.push('/sources') },
            ]}
          />
        </>
      }
      actions={
        <div className="flex gap-2 max-md:hidden">
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => useUI.getState().openCreatePlaylist()}>
            New playlist
          </Button>
          <Link href="/sources" className="inline-flex h-8 items-center rounded-full bg-surface-3 px-3.5 text-[13px] font-semibold hover:bg-active">
            Add music
          </Link>
        </div>
      }
    >
      <div className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <Tabs
          className="-mx-4 px-4 md:mx-0 md:px-0"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'playlists', label: 'Playlists' },
            { value: 'albums', label: 'Albums' },
            { value: 'artists', label: 'Artists' },
            { value: 'songs', label: 'Songs' },
            { value: 'podcasts', label: 'Podcasts' },
            { value: 'collections', label: 'Collections' },
          ]}
        />
        <div className="flex items-center gap-2">
          <div className={cn('relative max-md:flex-1', !searchOpen && 'max-md:hidden')}>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}`} aria-label={`Filter ${tab}`} className="h-10 w-full rounded-full bg-surface-2 pl-9 pr-3 text-sm outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-accent/40 md:h-9 md:w-56" />
          </div>
          {(tab === 'albums' || tab === 'artists') && (
            <Chip active={savedOnly} onClick={() => setSavedOnly(!savedOnly)}>
              {tab === 'albums' ? 'Saved' : 'Following'}
            </Chip>
          )}
          {(tab === 'albums' || tab === 'songs') && (
            <Menu
              trigger={<button className="h-9 rounded-full px-3 text-[13px] font-semibold text-fg-2 hover:text-fg">Sort: {sortLabel(sort)}</button>}
              items={(tab === 'albums' ? ['recent', 'title', 'artist', 'year'] : ['recent', 'title', 'artist', 'album', 'duration', 'year']).map((s) => ({ label: sortLabel(s), checked: s === sort, onSelect: () => setSort(s) }))}
            />
          )}
          {tab !== 'songs' && tab !== 'podcasts' && (
            <IconButton label={view === 'grid' ? 'List view' : 'Grid view'} size="sm" onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>
              {view === 'grid' ? <List /> : <LayoutGrid />}
            </IconButton>
          )}
        </div>
      </div>
      {tab === 'playlists' && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:hidden">
          <Link href="/sources" className="press flex h-12 items-center gap-2.5 rounded-[10px] bg-surface-2 px-3.5 text-[14px] font-semibold"><Server className="size-5 text-accent" /> Music folders</Link>
          <Link href="/history" className="press flex h-12 items-center gap-2.5 rounded-[10px] bg-surface-2 px-3.5 text-[14px] font-semibold"><History className="size-5 text-accent" /> Recently played</Link>
        </div>
      )}
      {tab === 'playlists' && <PlaylistsTab q={q} view={view} />}
      {tab === 'albums' && <AlbumsTab q={q} view={view} saved={savedOnly} sort={sort} />}
      {tab === 'artists' && <ArtistsTab q={q} view={view} followed={savedOnly} />}
      {tab === 'songs' && <SongsTab q={q} sort={sort} kind="music" />}
      {tab === 'podcasts' && <SongsTab q={q} sort="recent" kind="podcast" />}
      {tab === 'collections' && <CollectionsTab q={q} addRef={addRef} />}
    </Page>
  );
}

const sortLabel = (s: string) => ({ recent: 'Recently added', title: 'Title', artist: 'Artist', album: 'Album', duration: 'Duration', year: 'Year' })[s] ?? s;
const match = (q: string, ...v: (string | null | undefined)[]) => !q || v.some((x) => x?.toLowerCase().includes(q.toLowerCase()));

function ListRow({ href, art, title, subtitle }: { href: string; art: React.ReactNode; title: string; subtitle: React.ReactNode }) {
  return (
    <Link href={href} className="press flex items-center gap-3 rounded-xl py-2 transition hover:bg-hover md:px-2">
      {art}
      <div className="min-w-0">
        <div className="truncate font-semibold">{title}</div>
        <div className="truncate text-[13px] text-fg-2">{subtitle}</div>
      </div>
    </Link>
  );
}

function PlaylistsTab({ q, view }: { q: string; view: 'grid' | 'list' }) {
  const mounted = useMounted();
  const { data, isLoading: loading } = usePlaylists();
  const isLoading = loading || !mounted;
  const list = (data ?? []).filter((p) => match(q, p.name, p.description));
  const liked = { href: '/liked', title: 'Liked Songs' };
  if (isLoading) return <CardGrid><CardSkeletons n={10} /></CardGrid>;
  if (view === 'list')
    return (
      <div className="space-y-1">
        {match(q, 'liked songs') && <ListRow href={liked.href} title={liked.title} subtitle="Playlist" art={<div className="flex size-14 items-center justify-center rounded-lg bg-accent"><Heart className="size-6 fill-[var(--accent-ink)] text-[var(--accent-ink)]" /></div>} />}
        {list.map((p) => (
          <ListRow key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={`Playlist · ${p.ownerName} · ${plural(p.trackCount, 'song')}`} art={p.cover ? <Artwork src={p.cover} alt="" className="size-14" /> : <Mosaic covers={p.covers} alt="" className="size-14" seed={p.name} />} />
        ))}
      </div>
    );
  return (
    <CardGrid>
      {match(q, 'liked songs') && (
        <Link href="/liked" className="press group col-span-2 flex min-h-[180px] flex-col justify-end rounded-[12px] bg-accent p-5 text-accent-ink transition hover:brightness-105">
          <Heart className="mb-auto size-8 fill-current" />
          <div className="font-display text-3xl font-extrabold">Liked Songs</div>
          <div className="mt-1 text-sm opacity-75">All the songs you’ve saved</div>
        </Link>
      )}
      {list.map((p) => (
        <MediaCard key={p.id} href={`/playlist/${p.id}`} title={p.name} subtitle={`By ${p.ownerName}`} cover={p.cover} covers={p.covers} kind="playlist" context={{ type: 'playlist', id: p.id, title: p.name, href: `/playlist/${p.id}` }} load={() => loadPlaylist(p.id)} />
      ))}
      <button onClick={() => useUI.getState().openCreatePlaylist()} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-line-strong m-2.5 text-fg-2 transition hover:border-fg-2 hover:text-fg">
        <Plus className="size-8" />
        <span className="text-sm font-semibold">New playlist</span>
      </button>
    </CardGrid>
  );
}

function AlbumsTab({ q, view, saved, sort }: { q: string; view: 'grid' | 'list'; saved: boolean; sort: string }) {
  const s = sort === 'recent' ? 'added' : sort;
  const { data, isLoading } = useQuery({ queryKey: ['library', 'albums', saved, s], queryFn: () => api<Album[]>(`/api/library/albums?sort=${s}${saved ? '&saved=1' : ''}`) });
  const list = (data ?? []).filter((a) => match(q, a.title, a.artist));
  if (isLoading) return <CardGrid><CardSkeletons n={10} /></CardGrid>;
  if (!list.length) return <EmptyState icon={<LibraryIcon />} title={saved ? 'No saved albums yet' : 'No albums'} body={saved ? 'Tap the heart on an album to save it here.' : 'Add a source to fill your library.'} />;
  if (view === 'list')
    return (
      <div className="space-y-1">
        {list.map((a) => (
          <ListRow key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={[a.artist, a.year, plural(a.trackCount, 'song')].filter(Boolean).join(' · ')} art={<Artwork src={a.cover} alt="" className="size-14" kind="album" seed={a.title} />} />
        ))}
      </div>
    );
  return (
    <CardGrid>
      {list.map((a) => (
        <MediaCard key={a.id} href={`/album/${a.id}`} title={a.title} subtitle={[a.artist, a.year].filter(Boolean).join(' · ')} cover={a.cover} kind="album" context={{ type: 'album', id: a.id, title: a.title, href: `/album/${a.id}` }} load={() => loadAlbum(a.id)} />
      ))}
    </CardGrid>
  );
}

function ArtistsTab({ q, view, followed }: { q: string; view: 'grid' | 'list'; followed: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ['library', 'artists', followed], queryFn: () => api<Artist[]>(`/api/library/artists${followed ? '?followed=1' : ''}`) });
  const list = (data ?? []).filter((a) => match(q, a.name));
  if (isLoading) return <CardGrid><CardSkeletons n={10} round /></CardGrid>;
  if (!list.length) return <EmptyState title={followed ? 'You’re not following anyone yet' : 'No artists'} body={followed ? 'Follow artists to see them here and get more of them in your mixes.' : undefined} />;
  if (view === 'list')
    return (
      <div className="space-y-1">
        {list.map((a) => (
          <ListRow key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle={`${plural(a.trackCount, 'song')}`} art={<Artwork src={a.image} alt="" className="size-14" rounded="full" kind="artist" seed={a.name} />} />
        ))}
      </div>
    );
  return (
    <CardGrid>
      {list.map((a) => (
        <MediaCard key={a.id} href={`/artist/${a.id}`} title={a.name} subtitle={plural(a.trackCount, 'song')} cover={a.image} kind="artist" context={{ type: 'artist', id: a.id, title: a.name, href: `/artist/${a.id}` }} load={() => loadArtist(a.id)} />
      ))}
    </CardGrid>
  );
}

const PAGE = 300;

function SongsTab({ q, sort, kind }: { q: string; sort: string; kind: 'music' | 'podcast' }) {
  const s = sort === 'recent' ? 'added' : sort;
  const dq = useDebounced(q.trim(), 200);
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['library', 'tracks', kind, s, dq],
    queryFn: ({ pageParam }) => api<{ total: number; tracks: Track[] }>(`/api/library/tracks?sort=${s}&kind=${kind}&limit=${PAGE}&offset=${pageParam}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length * PAGE : undefined),
    placeholderData: (prev) => prev,
  });
  const total = data?.pages[0]?.total ?? 0;
  const rows = useMemo(() => (data?.pages ?? []).flatMap((pg) => pg.tracks).map((t) => ({ key: t.id, track: t, addedAt: t.addedAt })), [data]);
  // load the next page shortly before the end of the list comes into view
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !isFetchingNextPage && void fetchNextPage(), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);
  if (isLoading) return <TrackListSkeleton />;
  if (!rows.length && dq) return <EmptyState title={`No songs match “${dq}”`} />;
  if (!rows.length) return <EmptyState icon={kind === 'podcast' ? <Podcast /> : undefined} title={kind === 'podcast' ? 'No podcasts yet' : 'No songs in your library yet'} body={kind === 'podcast' ? 'Add a podcast RSS feed in Music Sources.' : 'Choose the folders where your music lives, or upload songs from this device.'} action={kind === 'podcast' ? <Link href="/sources" className="rounded-full bg-fg px-5 py-2.5 text-sm font-semibold text-bg">Add a feed</Link> : <Link href="/setup" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink">Add your music</Link>} />;
  return (
    <>
      <p className="mb-3 text-sm text-fg-2">{plural(total, kind === 'podcast' ? 'episode' : 'song')}</p>
      <TrackList rows={rows} context={{ type: 'library', title: kind === 'podcast' ? 'Podcasts' : 'Your Library', href: '/library?tab=songs' }} variant="search" showAdded />
      <div ref={sentinel} aria-hidden className="h-px" />
      {isFetchingNextPage && <TrackListSkeleton rows={4} />}
    </>
  );
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function CollectionsTab({ q, addRef }: { q: string; addRef: string | null }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ['collections'], queryFn: () => api<{ id: string; name: string; color: string | null; count: number }[]>('/api/collections') });
  const create = async () => {
    const name = window.prompt('Name your collection');
    if (!name?.trim()) return;
    const { id } = await api<{ id: string }>('/api/collections', { body: { name } });
    void qc.invalidateQueries({ queryKey: ['collections'] });
    if (addRef) await addTo(id, name);
  };
  const addTo = async (id: string, name: string) => {
    if (!addRef) return router.push(`/collection/${id}`);
    const [kind, refId] = addRef.split(':');
    await api(`/api/collections/${id}/items`, { body: { kind, refIds: [refId] } });
    void qc.invalidateQueries({ queryKey: ['collections'] });
    toast.success(`Added to “${name}”`);
    router.replace('/library?tab=collections');
  };
  const list = (data ?? []).filter((c) => match(q, c.name));
  return (
    <div>
      {addRef && <div className="mb-4 rounded-xl bg-accent/10 p-4 text-sm font-medium text-accent">Choose a collection to add this to, or create a new one.</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button onClick={() => void create()} className="flex h-24 items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-line-strong text-fg-2 transition hover:border-fg-2 hover:text-fg">
          <FolderPlus className="size-5" /> New collection
        </button>
        {isLoading && <div className="skeleton h-24 rounded-[18px]" />}
        {list.map((c) => (
          <div key={c.id} className="group relative">
            <button onClick={() => void addTo(c.id, c.name)} className={cn('flex h-24 w-full items-center gap-4 rounded-[18px] bg-surface-2 px-5 text-left transition hover:bg-surface-3')}>
              <div className="flex size-12 items-center justify-center rounded-xl bg-accent/15 text-accent"><Folder className="size-5" /></div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{c.name}</div>
                <div className="text-[13px] text-fg-2">{plural(c.count, 'item')}</div>
              </div>
            </button>
            <button
              aria-label={`Delete ${c.name}`}
              onClick={async () => {
                if (await confirmDialog({ title: `Delete “${c.name}”?`, body: 'The music inside stays in your library.', confirmLabel: 'Delete', danger: true })) {
                  await api(`/api/collections/${c.id}`, { method: 'DELETE' });
                  void qc.invalidateQueries({ queryKey: ['collections'] });
                }
              }}
              className="absolute right-3 top-3 rounded-full p-2 text-fg-3 opacity-0 transition hover:bg-hover hover:text-danger group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      {!isLoading && !list.length && !addRef && <p className="mt-6 text-sm text-fg-2">Collections let you group songs, albums, artists and playlists however you like — “Wedding”, “Vinyl to buy”, “Kids”…</p>}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryInner />
    </Suspense>
  );
}
