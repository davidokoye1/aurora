'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link2, Upload, Server, Search, ChevronDown, Plus, Trash2, RefreshCw, Pause, Play, Square, FileText, Settings2, CheckCircle2, AlertTriangle, Globe, ListMusic,
  Rss, Braces, Radio, FolderOpen, Loader2, X, ShieldCheck, Info,
} from 'lucide-react';
import { api } from '@/lib/client/api';
import { fmtAgo, plural } from '@/lib/client/format';
import { useMe } from '@/lib/client/hooks';
import type { SourceDTO, SyncProgress } from '@/lib/types';
import type { DetectResult, SourceConfig } from '@/lib/server/sources/types';
import { Page } from '@/components/layout/page';
import { Button, IconButton, Spinner } from '@/components/ui/button';
import { Input, Label, Switch, EmptyState, ErrorState, Skeleton, Tabs } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { Menu } from '@/components/ui/menu';
import { cn } from '@/components/ui/cn';
import { toast, confirmDialog } from '@/stores/ui';
import { UploadZone } from './upload-zone';
import { FolderPicker } from './folder-picker';
import { useSyncLive } from '@/stores/sync';

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  http: { label: 'Web / directory', icon: <Globe /> },
  playlist: { label: 'Playlist file', icon: <ListMusic /> },
  manifest: { label: 'JSON manifest', icon: <Braces /> },
  rss: { label: 'Podcast feed', icon: <Rss /> },
  subsonic: { label: 'Subsonic server', icon: <Radio /> },
  jellyfin: { label: 'Jellyfin / Emby', icon: <Server /> },
  folder: { label: 'Folder', icon: <FolderOpen /> },
  upload: { label: 'Uploads', icon: <Upload /> },
};

export function SourcesView() {
  const me = useMe();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const initial = sp.get('add');
  const [tab, setTab] = useState<'url' | 'upload' | 'folder'>(initial === 'upload' ? 'upload' : initial === 'url' ? 'url' : me.isAdmin ? 'folder' : 'upload');
  const { data: sources, error, refetch, isLoading } = useQuery({ queryKey: ['sources'], queryFn: () => api<SourceDTO[]>('/api/sources'), refetchInterval: 15_000 });
  const live = useSyncLive((st) => st.live);


  const welcome = sp.get('welcome') === '1';

  return (
    <Page
      title="Music Sources"
      subtitle="The folders and places your music comes from. Folders stay in sync by themselves."
      back
      actions={
        me.isAdmin ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw className="size-3.5" />}
            onClick={async () => {
              try {
                const r = await api<{ albums: number; artists: number }>('/api/library/refresh', { method: 'POST' });
                toast.success(r.albums + r.artists ? `Looking up artwork for ${r.albums} albums and ${r.artists} artists…` : 'Everything already has artwork');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Find missing artwork
          </Button>
        ) : undefined
      }
    >
      {welcome && (
        <div className="mb-6 flex items-start gap-3 rounded-[18px] border border-accent/40 bg-accent/10 p-5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">Welcome to Aurora{me.isAdmin ? ' — you’re the admin of this server' : ''}.</div>
            <p className="mt-1 text-sm text-fg-2">Add your first source below. Uploads and folders are indexed instantly; URL sources are crawled in the background and you can start listening while they import.</p>
          </div>
        </div>
      )}

      <section className="rounded-[16px] border border-line bg-surface p-4 md:p-6" aria-label="Add a source">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            ...(me.isAdmin ? [{ value: 'folder' as const, label: 'Folder or drive' }] : []),
            { value: 'upload', label: 'Upload files' },
            { value: 'url', label: 'Network / URL' },
          ]}
          className="mb-5"
        />
        {tab === 'url' && <AddByUrl />}
        {tab === 'upload' && <UploadZone />}
        {tab === 'folder' && <AddFolder />}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 font-display text-[21px] font-extrabold md:text-2xl">Your sources</h2>
        {error ? (
          <ErrorState error={error} retry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-[18px]" />)}</div>
        ) : !sources?.filter((s) => s.type !== 'upload' || s.trackCount > 0).length ? (
          <EmptyState icon={<Link2 />} title="No sources yet" body="Paste a link to a music library above, or upload some files to get started." />
        ) : (
          <div className="space-y-3">
            {sources
              .filter((s) => s.type !== 'upload' || s.trackCount > 0)
              .map((s) => (
                <SourceCard key={s.id} source={s} live={live[s.id]} />
              ))}
          </div>
        )}
      </section>

      <ManifestHelp />
    </Page>
  );
}

/* ------------------------------------------------------------------ add by URL */

interface AccessState {
  username: string;
  password: string;
  apiKey: string;
  headers: { k: string; v: string }[];
  maxDepth: string;
  maxFiles: string;
  concurrency: string;
  delayMs: string;
  include: string;
  exclude: string;
  renderJs: boolean;
  wideScope: boolean;
}

const emptyAccess = (): AccessState => ({ username: '', password: '', apiKey: '', headers: [], maxDepth: '', maxFiles: '', concurrency: '', delayMs: '', include: '', exclude: '', renderJs: false, wideScope: false });

export function accessToConfig(a: AccessState): SourceConfig {
  const num = (s: string) => (s.trim() ? Number(s) : undefined);
  const list = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const headers: Record<string, string> = {};
  for (const h of a.headers) if (h.k.trim()) headers[h.k.trim().toLowerCase()] = h.v;
  return {
    username: a.username || undefined,
    password: a.password || undefined,
    apiKey: a.apiKey || undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    maxDepth: num(a.maxDepth),
    maxFiles: num(a.maxFiles),
    concurrency: num(a.concurrency),
    delayMs: num(a.delayMs),
    include: a.include ? list(a.include) : undefined,
    exclude: a.exclude ? list(a.exclude) : undefined,
    renderJs: a.renderJs || undefined,
    wideScope: a.wideScope || undefined,
  };
}

function AddByUrl() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [access, setAccess] = useState<AccessState>(emptyAccess);
  const [showAccess, setShowAccess] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('http');
  const [adding, setAdding] = useState(false);

  const detect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setDetecting(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api<DetectResult>('/api/sources/detect', { body: { url: url.trim(), config: accessToConfig(access) } });
      setResult(r);
      setName(r.name);
      setType(r.type);
      if (r.needsAuth) setShowAccess(true);
      if (r.suggestRenderJs) setShowAccess(true);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  const add = async () => {
    if (!result) return;
    setAdding(true);
    try {
      await api('/api/sources', { body: { type, name: name.trim() || result.name, url: result.finalUrl, config: accessToConfig(access) } });
      toast.success(`Importing “${name || result.name}” — you can keep browsing while it syncs.`);
      setResult(null);
      setUrl('');
      setAccess(emptyAccess());
      setShowAccess(false);
      void qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const needsCreds = result?.needsAuth === 'subsonic' ? !access.username || !access.password : result?.needsAuth === 'jellyfin' ? !access.apiKey && (!access.username || !access.password) : result?.needsAuth === 'basic' ? !access.username : false;

  return (
    <div>
      <form onSubmit={detect} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… a folder listing, playlist (.m3u/.pls/.xspf), feed, JSON manifest, or media server"
            className="h-12 pl-11 text-[15px]"
            aria-label="Source URL"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" loading={detecting} icon={<Search className="size-4" />} disabled={!url.trim()}>
          Detect
        </Button>
      </form>
      <button onClick={() => setShowAccess((v) => !v)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg-2 hover:text-fg" aria-expanded={showAccess}>
        <Settings2 className="size-4" /> Access & crawl options <ChevronDown className={cn('size-4 transition', showAccess && 'rotate-180')} />
      </button>
      {showAccess && <AccessForm value={access} onChange={setAccess} type={result?.type ?? 'http'} />}

      {err && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl bg-danger/10 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">Couldn’t use that URL</div>
            <div className="mt-0.5 text-danger/90">{err}</div>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-5 animate-rise rounded-[18px] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent [&_svg]:size-5">{TYPE_META[result.type]?.icon}</div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-accent">{result.label}</div>
                <div className="mt-0.5 font-semibold">{result.detail}</div>
                <div className="mt-0.5 break-all text-xs text-fg-3">{result.finalUrl}</div>
              </div>
            </div>
            <IconButton label="Dismiss" size="sm" onClick={() => setResult(null)}>
              <X />
            </IconButton>
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
              <Info className="mt-0.5 size-4 shrink-0" /> {w}
            </p>
          ))}
          {result.needsAuth && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
              {result.needsAuth === 'subsonic' ? 'Enter your server username and password under Access options.' : result.needsAuth === 'jellyfin' ? 'Enter an API key (Dashboard → API Keys) or your username and password under Access options.' : 'Enter the username and password for this site under Access options.'} Credentials are encrypted on the server and never sent to your browser.
            </p>
          )}
          {result.preview.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-3">Preview</div>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {result.preview.map((p, i) => (
                  <li key={i} className="min-w-0 text-sm">
                    <span className="block truncate font-medium">{p.title}</span>
                    {p.detail && <span className="block truncate text-xs text-fg-2">{p.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px]">
            <div>
              <Label htmlFor="src-name">Name</Label>
              <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div>
              <Label htmlFor="src-type">Import as</Label>
              <select id="src-type" value={type} onChange={(e) => setType(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent">
                {['http', 'playlist', 'manifest', 'rss', 'subsonic', 'jellyfin'].map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {result.needsAuth && (
              <Button variant="ghost" onClick={() => void detect()} loading={detecting}>
                Re-check with credentials
              </Button>
            )}
            <Button variant="primary" size="lg" onClick={add} loading={adding} disabled={needsCreds} icon={<Plus className="size-4" />}>
              Import library
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccessForm({ value, onChange, type }: { value: AccessState; onChange: (v: AccessState) => void; type: string }) {
  const set = <K extends keyof AccessState>(k: K, v: AccessState[K]) => onChange({ ...value, [k]: v });
  const crawl = type === 'http';
  return (
    <div className="mt-4 grid animate-fade-in gap-5 rounded-[18px] border border-line bg-surface p-5 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="text-sm font-semibold">Credentials</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="acc-user">Username</Label>
            <Input id="acc-user" value={value.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="acc-pass">Password</Label>
            <Input id="acc-pass" type="password" value={value.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <div>
          <Label htmlFor="acc-key" hint="Jellyfin / Emby">API key</Label>
          <Input id="acc-key" value={value.apiKey} onChange={(e) => set('apiKey', e.target.value)} autoComplete="off" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-fg-2">Custom headers</span>
            <button onClick={() => set('headers', [...value.headers, { k: '', v: '' }])} className="text-xs font-semibold text-accent hover:underline">
              + Add header
            </button>
          </div>
          {value.headers.length === 0 && <p className="text-xs text-fg-3">e.g. Cookie, Referer or User-Agent, if the site needs them.</p>}
          <div className="space-y-2">
            {value.headers.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input value={h.k} placeholder="Header" onChange={(e) => set('headers', value.headers.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} className="h-9 w-40" />
                <Input value={h.v} placeholder="Value" onChange={(e) => set('headers', value.headers.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} className="h-9" />
                <IconButton label="Remove header" size="sm" onClick={() => set('headers', value.headers.filter((_, j) => j !== i))}>
                  <X />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={cn('space-y-3', !crawl && 'opacity-60')}>
        <div className="text-sm font-semibold">Crawling {!crawl && <span className="font-normal text-fg-3">(web pages only)</span>}</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="acc-depth">Max folder depth</Label>
            <Input id="acc-depth" inputMode="numeric" placeholder="10" value={value.maxDepth} onChange={(e) => set('maxDepth', e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <Label htmlFor="acc-files">Max files</Label>
            <Input id="acc-files" inputMode="numeric" placeholder="50000" value={value.maxFiles} onChange={(e) => set('maxFiles', e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <Label htmlFor="acc-conc">Parallel requests</Label>
            <Input id="acc-conc" inputMode="numeric" placeholder="4" value={value.concurrency} onChange={(e) => set('concurrency', e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <Label htmlFor="acc-delay">Delay between requests (ms)</Label>
            <Input id="acc-delay" inputMode="numeric" placeholder="0" value={value.delayMs} onChange={(e) => set('delayMs', e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="acc-inc" hint="globs">Only include</Label>
            <Input id="acc-inc" placeholder="*.flac, Jazz/**" value={value.include} onChange={(e) => set('include', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="acc-exc" hint="globs">Exclude</Label>
            <Input id="acc-exc" placeholder="*/Samples/*" value={value.exclude} onChange={(e) => set('exclude', e.target.value)} />
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
          <span>
            <span className="block text-sm font-semibold">Render JavaScript</span>
            <span className="block text-xs text-fg-2">For pages that build their track list in the browser. Slower.</span>
          </span>
          <Switch checked={value.renderJs} onChange={(v) => set('renderJs', v)} label="Render JavaScript" />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
          <span>
            <span className="block text-sm font-semibold">Follow links outside the starting folder</span>
            <span className="block text-xs text-fg-2">Crawl the whole site (same host) instead of only below this URL.</span>
          </span>
          <Switch checked={value.wideScope} onChange={(v) => set('wideScope', v)} label="Wide scope" />
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ server folder */

function AddFolder() {
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <FolderPicker />
      <details className="rounded-[12px] border border-line px-3 py-2 text-sm">
        <summary className="cursor-pointer py-1 font-semibold text-fg-2">Type a path instead (network shares like \\NAS\Music)</summary>
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const p = path.trim();
              await api('/api/sources', { body: { type: 'folder', name: p.split(/[\\/]+/).filter(Boolean).pop() || 'Music folder', config: { path: p } } });
              toast.success('Adding folder…');
              setPath('');
              void qc.invalidateQueries({ queryKey: ['sources'] });
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input aria-label="Folder path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\\Music" spellCheck={false} className="flex-1" />
          <Button type="submit" variant="secondary" loading={busy} disabled={!path.trim()}>Add</Button>
        </form>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ source card */

function SourceCard({ source: s, live }: { source: SourceDTO; live?: SyncProgress }) {
  const qc = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const job = live ?? s.job;
  const running = job?.status === 'running' || s.status === 'syncing';
  const meta = TYPE_META[s.type] ?? TYPE_META.http;
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      void qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const h = s.health;
  return (
    <div className="rounded-[16px] border border-line bg-surface p-4 transition hover:border-line-strong md:p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-fg [&_svg]:size-5 md:size-12">{meta.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[16px] font-semibold">{s.name}</h3>
            <StatusPill status={running ? 'syncing' : s.status} />
          </div>
          <div className="mt-0.5 truncate text-[13px] text-fg-2">
            {meta.label}
            {s.url && <> · <span className="break-all">{s.url}</span></>}
            {s.config.path && <> · {s.config.path}</>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-2">
            <span>{plural(s.trackCount, 'track')}</span>
            {s.lastSyncAt && <span>Synced {fmtAgo(s.lastSyncAt)}</span>}
            {h && h.sampled > 0 && (
              <span className={cn(h.playable === h.sampled ? 'text-success' : 'text-warning')}>
                {h.playable}/{h.sampled} sample tracks verified playable
                {h.rangeSupport === false && ' · no seeking support upstream (emulated)'}
              </span>
            )}
            {h?.unplayableFormats.length ? <span className="text-warning">Browser can’t play: {h.unplayableFormats.join(', ').toUpperCase()}</span> : null}
          </div>
          {s.status === 'offline' && !running ? (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Plug the drive back in — Aurora reconnects by itself. Your {plural(s.trackCount, 'song')} stay in your library meanwhile.
            </p>
          ) : (
            s.error && !running && (
              <p className="mt-2 flex items-start gap-1.5 text-[13px] text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {s.error}
              </p>
            )
          )}
        </div>
        <div className="flex items-center gap-1 max-sm:order-last max-sm:w-full max-sm:justify-end max-sm:border-t max-sm:border-line max-sm:pt-3">
          {s.type !== 'upload' &&
            (running ? (
              <Button size="sm" variant="secondary" icon={<Square className="size-3.5" />} onClick={() => act(() => api(`/api/sources/${s.id}/sync`, { method: 'DELETE' }), 'Stopping sync…')}>
                Stop
              </Button>
            ) : (
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} disabled={s.paused} onClick={() => act(() => api(`/api/sources/${s.id}/sync`, { method: 'POST' }), 'Sync started')}>
                Sync now
              </Button>
            ))}
          <Menu
            trigger={
              <span>
                <IconButton label="Source options" size="sm">
                  <Settings2 />
                </IconButton>
              </span>
            }
            items={[
              { label: 'View sync log', icon: <FileText />, onSelect: () => setLogOpen(true) },
              ...(s.type !== 'upload' && s.type !== 'folder'
                ? [{ label: 'Edit access & crawl options', icon: <Settings2 />, onSelect: () => setEditOpen(true) }]
                : []),
              ...(s.type !== 'upload'
                ? [
                    { label: s.paused ? 'Resume source' : 'Pause source', icon: s.paused ? <Play /> : <Pause />, onSelect: () => act(() => api(`/api/sources/${s.id}`, { method: 'PATCH', body: { paused: !s.paused } }), s.paused ? 'Source resumed' : 'Source paused — its tracks are hidden from playback') },
                    { separator: true, label: '' },
                    {
                      label: 'Remove source',
                      icon: <Trash2 />,
                      danger: true,
                      onSelect: async () => {
                        if (await confirmDialog({ title: `Remove “${s.name}”?`, body: 'Its tracks will be removed from your library (songs you liked or added to playlists are kept but become unavailable).', confirmLabel: 'Remove', danger: true }))
                          void act(() => api(`/api/sources/${s.id}`, { method: 'DELETE' }), 'Source removed');
                      },
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
      {running && job && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_linear_infinite] rounded-full bg-accent" style={{ backgroundSize: '200% 100%', width: job.found ? `${Math.max(8, Math.min(100, ((job.imported + (job.unchanged ?? 0) + job.errors) / Math.max(1, job.found)) * 100))}%` : '15%' }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
            <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> {s.type === 'folder' || s.type === 'upload' ? 'Scanning…' : 'Importing…'}</span>
            {job.pages > 0 && <span>{plural(job.pages, 'page')} scanned</span>}
            <span>{plural(job.found, 'file')} found</span>
            <span>{plural(job.imported, 'new song')}</span>
            {!!job.unchanged && <span>{plural(job.unchanged, 'unchanged')}</span>}
            {job.errors > 0 && <span className="text-warning">{plural(job.errors, 'error')}</span>}
          </div>
          {job.log.length > 0 && <p className="mt-1 truncate font-mono text-[11px] text-fg-3">{job.log[job.log.length - 1]}</p>}
        </div>
      )}
      <LogDialog open={logOpen} onOpenChange={setLogOpen} source={s} />
      {editOpen && <EditDialog source={s} onClose={() => setEditOpen(false)} />}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    syncing: ['Syncing', 'bg-accent/15 text-accent'],
    ok: ['Ready', 'bg-success/15 text-success'],
    idle: ['Waiting', 'bg-surface-3 text-fg-2'],
    error: ['Error', 'bg-danger/15 text-danger'],
    paused: ['Paused', 'bg-warning/15 text-warning'],
    offline: ['Not connected', 'bg-warning/15 text-warning'],
  };
  const [label, cls] = map[status] ?? map.idle;
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider', cls)}>{label}</span>;
}

function LogDialog({ open, onOpenChange, source }: { open: boolean; onOpenChange: (o: boolean) => void; source: SourceDTO }) {
  const { data, isLoading } = useQuery({ queryKey: ['source-log', source.id], queryFn: () => api<{ log: string[] }>(`/api/sources/${source.id}/log`), enabled: open, refetchInterval: open ? 2000 : false });
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [data]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Sync log" description={source.name} className="max-w-3xl">
      {isLoading ? (
        <Spinner />
      ) : (
        <pre ref={box} className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-4 font-mono text-xs leading-relaxed text-fg-2">
          {data?.log.length ? data.log.join('\n') : 'No log yet.'}
        </pre>
      )}
    </Dialog>
  );
}

function EditDialog({ source, onClose }: { source: SourceDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const c = source.config;
  const [name, setName] = useState(source.name);
  const [access, setAccess] = useState<AccessState>({
    ...emptyAccess(),
    username: c.username ?? '',
    headers: Object.entries(c.headers ?? {}).map(([k, v]) => ({ k, v })),
    maxDepth: c.maxDepth?.toString() ?? '',
    maxFiles: c.maxFiles?.toString() ?? '',
    concurrency: c.concurrency?.toString() ?? '',
    delayMs: c.delayMs?.toString() ?? '',
    include: (c.include ?? []).join(', '),
    exclude: (c.exclude ?? []).join(', '),
    renderJs: !!c.renderJs,
    wideScope: !!c.wideScope,
  });
  const [busy, setBusy] = useState(false);
  const save = async (resync: boolean) => {
    setBusy(true);
    try {
      const cfg = accessToConfig(access);
      await api(`/api/sources/${source.id}`, { method: 'PATCH', body: { name, config: { ...cfg, headers: cfg.headers ?? {}, include: cfg.include ?? [], exclude: cfg.exclude ?? [], renderJs: !!cfg.renderJs, wideScope: !!cfg.wideScope }, resync } });
      toast.success(resync ? 'Saved — re-syncing now' : 'Saved');
      void qc.invalidateQueries({ queryKey: ['sources'] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit source"
      description={c.hasPassword || c.hasApiKey ? 'Leave password / API key blank to keep the saved one.' : undefined}
      className="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save(false)} loading={busy}>
            Save
          </Button>
          <Button variant="primary" onClick={() => save(true)} loading={busy}>
            Save & re-sync
          </Button>
        </>
      }
    >
      <Label htmlFor="edit-name">Name</Label>
      <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      <AccessForm value={access} onChange={setAccess} type={source.type} />
    </Dialog>
  );
}

function ManifestHelp() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-10 rounded-[18px] border border-line p-5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left" aria-expanded={open}>
        <span>
          <span className="block font-semibold">What URLs work?</span>
          <span className="block text-sm text-fg-2">Supported source types and the JSON manifest format.</span>
        </span>
        <ChevronDown className={cn('size-5 shrink-0 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-5 grid gap-6 text-sm text-fg-2 lg:grid-cols-2">
          <ul className="space-y-2">
            <li><b className="text-fg">Directory listings</b> — Apache, nginx, Caddy, IIS, lighttpd “Index of” pages. Sub-folders are crawled; folder names become artists/albums; cover.jpg/folder.jpg become artwork.</li>
            <li><b className="text-fg">Any web page with audio links</b> — direct links, &lt;audio&gt; tags, download buttons (download.php?id=…), JSON-LD, links built in inline scripts, paginated listings (“Next”, ?page=2).</li>
            <li><b className="text-fg">Playlist files</b> — M3U/M3U8 (with #EXTINF), PLS and XSPF, including nested playlists.</li>
            <li><b className="text-fg">Zip archives</b> of albums — listed remotely without downloading when the server supports range requests.</li>
            <li><b className="text-fg">Podcast / RSS / Atom feeds</b> with audio enclosures.</li>
            <li><b className="text-fg">Subsonic-compatible servers</b> (Navidrome, Airsonic, Gonic…) and <b className="text-fg">Jellyfin / Emby</b> — including their playlists.</li>
            <li>Sites behind CAPTCHAs, anti-bot walls or DRM can’t be imported.</li>
          </ul>
          <pre className="overflow-auto rounded-xl bg-bg p-4 font-mono text-xs leading-relaxed">{`{
  "name": "My Collection",
  "albums": [{
    "title": "Album Name",
    "artist": "Artist",
    "year": 2021,
    "cover": "covers/album.jpg",
    "tracks": [
      { "title": "Song", "url": "audio/01.mp3", "duration": 215 },
      "audio/02.flac"
    ]
  }],
  "playlists": [{ "name": "Favourites", "tracks": ["audio/01.mp3"] }]
}

// Also accepted: a top-level array of tracks or URLs,
// or { "tracks": [...] } with url/src/file/stream fields.
// Relative URLs resolve against the manifest's URL.`}</pre>
        </div>
      )}
    </section>
  );
}
