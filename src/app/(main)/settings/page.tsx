'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronUp, ChevronDown, Moon, Sun, MonitorSmartphone } from 'lucide-react';
import { api } from '@/lib/client/api';
import { useMe, useSettings } from '@/lib/client/hooks';
import { usePlayer } from '@/stores/player';
import { toast, confirmDialog } from '@/stores/ui';
import type { Me, UserSettings } from '@/lib/types';
import { Page } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch } from '@/components/ui/misc';
import { EqualizerPanel } from '@/components/player/equalizer';
import { SHORTCUTS } from '@/components/dialogs/dialogs';
import { cn } from '@/components/ui/cn';

const ACCENTS = ['#ff5b2e', '#e0a32e', '#8fae4a', '#3fa38f', '#4f86d9', '#c46f9a', '#d9544d', '#efe9e1'];
const SECTIONS: Record<string, string> = {
  quick: 'Quick picks',
  recent: 'Recently played',
  mixes: 'Made for you',
  discover: 'Your discoveries',
  added: 'New in your library',
  albums: 'Albums for you',
  artists: 'Top artists',
  moods: 'Moods & moments',
  forgotten: 'Forgotten favorites',
};

export default function SettingsPage() {
  const me = useMe();
  const { settings: s, update } = useSettings();
  const nav = ['Account', 'Appearance', 'Playback', 'Equalizer', 'Content & privacy', ...(me.isAdmin ? ['Library & metadata'] : []), 'Shortcuts', 'Use it on your phone', 'About'];
  return (
    <Page title="Settings" back>
      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="sticky top-20 hidden h-fit space-y-1 lg:block" aria-label="Settings sections">
          {nav.map((n) => (
            <a key={n} href={`#${slug(n)}`} className="block rounded-lg px-3 py-2 text-sm font-medium text-fg-2 hover:bg-hover hover:text-fg">
              {n}
            </a>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl space-y-8 md:space-y-12">
          <Account me={me} />

          <Section title="Appearance">
            <Row label="Theme">
              <div className="flex gap-2">
                {([['dark', 'Dark', <Moon key="d" className="size-4" />], ['oled', 'Black', <MonitorSmartphone key="o" className="size-4" />], ['light', 'Light', <Sun key="l" className="size-4" />]] as const).map(([v, l, icon]) => (
                  <button key={v} onClick={() => update({ theme: v })} className={cn('flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition', s.theme === v ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-hover')}>
                    {icon}
                    {l}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Accent color" hint="Used for buttons, highlights and the now-playing glow.">
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => (
                  <button key={c} aria-label={`Accent ${c}`} onClick={() => update({ accent: c })} className="relative size-8 rounded-full ring-offset-2 ring-offset-[var(--bg)] transition hover:scale-110" style={{ background: c, boxShadow: s.accent === c ? `0 0 0 2px var(--bg), 0 0 0 4px ${c}` : undefined }}>
                    {s.accent === c && <Check className="absolute inset-0 m-auto size-4 text-black/70" />}
                  </button>
                ))}
                <label className="relative size-8 cursor-pointer overflow-hidden rounded-full border border-line-strong" title="Custom colour">
                  <input type="color" value={s.accent} onChange={(e) => update({ accent: e.target.value })} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Custom accent colour" />
                  <span className="flex size-full items-center justify-center bg-surface-3 text-lg font-semibold text-fg-2">+</span>
                </label>
              </div>
            </Row>
            <Toggle label="Color the player from artwork" hint="The full-screen player takes its background tone from the album art." checked={s.adaptiveAccent} onChange={(v) => update({ adaptiveAccent: v })} />
            <Toggle label="Reduce motion" hint="Turns off animated backgrounds and transitions." checked={s.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
            <Row label="Home sections" hint="Reorder or hide the shelves on your home screen.">
              <HomeOrder value={s.homeOrder} onChange={(v) => update({ homeOrder: v })} />
            </Row>
          </Section>

          <Section title="Playback">
            <Row label={`Crossfade${s.crossfade ? `: ${s.crossfade}s` : ': off'}`} hint="Blend the end of one song into the next.">
              <input type="range" min={0} max={12} step={1} value={s.crossfade} onChange={(e) => update({ crossfade: Number(e.target.value) })} className="slider w-full sm:w-64" style={{ ['--pct' as string]: `${(s.crossfade / 12) * 100}%` }} aria-label="Crossfade seconds" />
            </Row>
            <Toggle label="Gapless playback" hint="Preloads the next song so albums flow without pauses." checked={s.gapless} onChange={(v) => update({ gapless: v })} />
            <Toggle label="Autoplay" hint="When your music ends, keep playing similar songs." checked={usePlayer.getState().autoplayEnabled} onChange={(v) => usePlayer.getState().setAutoplay(v)} />
            <Toggle label="Normalize volume" hint="Even out loudness between songs (ReplayGain or measured loudness)." checked={s.normalize} onChange={(v) => update({ normalize: v })} />
            <Row label="Streaming quality" hint="When a song exists in several sources, pick the best quality or the smallest file.">
              <Segmented value={s.quality} onChange={(v) => update({ quality: v as UserSettings['quality'] })} options={[['best', 'Best available'], ['smallest', 'Data saver']]} />
            </Row>
            <Row label="Download quality">
              <Segmented value={s.downloadQuality} onChange={(v) => update({ downloadQuality: v as UserSettings['downloadQuality'] })} options={[['best', 'Best available'], ['smallest', 'Data saver']]} />
            </Row>
          </Section>

          <Section title="Equalizer">
            <div className="-mx-4 md:mx-0 md:rounded-[18px] md:bg-surface-2/40">
              <EqualizerPanel />
            </div>
          </Section>

          <Section title="Content & privacy">
            <Toggle label="Hide explicit content" hint="Explicit songs (as tagged) are skipped in mixes, search and autoplay." checked={s.explicitFilter} onChange={(v) => update({ explicitFilter: v })} />
            <Toggle label="Private session" hint="While on, nothing you play is recorded or used for recommendations." checked={s.privateSession} onChange={(v) => update({ privateSession: v })} />
            <Row label="Listening history">
              <Link href="/history" className="text-sm font-semibold text-accent hover:underline">View or clear history →</Link>
            </Row>
            <Row label="Downloads">
              <Link href="/downloads" className="text-sm font-semibold text-accent hover:underline">Manage offline storage →</Link>
            </Row>
          </Section>

          {me.isAdmin && (
            <Section title="Library & metadata">
              <p className="-mt-2 text-sm text-fg-2">Aurora fills in missing artwork, artist info and lyrics from free, open metadata services. Only song/artist/album names are sent to them — never your files.</p>
              <Toggle label="MusicBrainz" hint="Release years, artist genres, biographies (via Wikidata/Wikipedia) and artist photos." checked={s.enrichment.musicbrainz} onChange={(v) => update({ enrichment: { ...s.enrichment, musicbrainz: v } })} />
              <Toggle label="Cover Art Archive" hint="Album artwork for releases that don’t include it." checked={s.enrichment.coverart} onChange={(v) => update({ enrichment: { ...s.enrichment, coverart: v } })} />
              <Toggle label="LRCLIB lyrics" hint="Time-synced lyrics, fetched when you open the lyrics view." checked={s.enrichment.lyrics} onChange={(v) => update({ enrichment: { ...s.enrichment, lyrics: v } })} />
              <AllowSignup />
              <Row label="Sources">
                <Link href="/sources" className="text-sm font-semibold text-accent hover:underline">Manage music sources →</Link>
              </Row>
            </Section>
          )}

          <Section title="Shortcuts">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt><kbd className="rounded-md border border-line-strong bg-surface-2 px-2 py-0.5 font-mono text-xs">{k}</kbd></dt>
                  <dd className="text-fg-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Use it on your phone">
            <PhonePanel />
          </Section>

          <Section title="About">
            <p className="text-sm text-fg-2">Aurora 1.0 — a self-hosted, personal music player. Install it from your browser’s menu (“Install app” / “Add to Home Screen”) for a full-screen app with media-key and lock-screen controls.</p>
          </Section>
        </div>
      </div>
    </Page>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id={slug(title)} className="scroll-mt-24">
      <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-[0.12em] text-fg-2 md:mb-4 md:px-0 md:font-display md:text-2xl md:normal-case md:tracking-normal md:text-fg">{title}</h2>
      <div className="overflow-hidden rounded-[14px] bg-surface px-4 md:space-y-5 md:overflow-visible md:rounded-none md:bg-transparent md:px-0 [&>*:last-child]:border-b-0">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line py-3.5 sm:flex-row sm:items-center sm:justify-between md:py-0 md:pb-5">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold md:text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-fg-2">{hint}</div>}
      </div>
      <div className="min-w-0 shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3.5 md:py-0 md:pb-5">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold md:text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-fg-2">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold transition', value === v ? 'bg-surface-3 text-fg shadow' : 'text-fg-2 hover:text-fg')}>
          {l}
        </button>
      ))}
    </div>
  );
}

function HomeOrder({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const all = Object.keys(SECTIONS);
  const hidden = all.filter((k) => !value.includes(k));
  const move = (i: number, d: number) => {
    const n = [...value];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div className="w-full space-y-1 sm:w-72">
      {value.filter((k) => SECTIONS[k]).map((k, i) => (
        <div key={k} className="flex h-10 items-center gap-2 rounded-lg bg-surface-2 pl-3 pr-1 text-sm">
          <span className="flex-1">{SECTIONS[k]}</span>
          <button aria-label="Move up" onClick={() => move(i, -1)} className="rounded p-1 text-fg-2 hover:text-fg disabled:opacity-30" disabled={i === 0}><ChevronUp className="size-4" /></button>
          <button aria-label="Move down" onClick={() => move(i, 1)} className="rounded p-1 text-fg-2 hover:text-fg disabled:opacity-30" disabled={i === value.length - 1}><ChevronDown className="size-4" /></button>
          <Switch checked label={`Show ${SECTIONS[k]}`} onChange={() => onChange(value.filter((x) => x !== k))} />
        </div>
      ))}
      {hidden.map((k) => (
        <div key={k} className="flex h-10 items-center gap-2 rounded-lg pl-3 pr-1 text-sm text-fg-3">
          <span className="flex-1">{SECTIONS[k]}</span>
          <Switch checked={false} label={`Show ${SECTIONS[k]}`} onChange={() => onChange([...value, k])} />
        </div>
      ))}
    </div>
  );
}

function AllowSignup() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['server-settings'], queryFn: () => api<{ allowSignup: boolean }>('/api/admin/settings') });
  return (
    <Toggle
      label="Allow new accounts"
      hint="Let other people create accounts on this server (needed for collaborative playlists). Anyone with an account can add music sources."
      checked={!!data?.allowSignup}
      onChange={async (v) => {
        await api('/api/admin/settings', { method: 'PUT', body: { allowSignup: v } });
        void qc.invalidateQueries({ queryKey: ['server-settings'] });
        toast.success(v ? 'New accounts allowed' : 'New accounts closed');
      }}
    />
  );
}

function Account({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const next = await api<Me>('/api/me', { method: 'PATCH', body: { name, email, currentPassword: cur || undefined, newPassword: pw || undefined } });
      qc.setQueryData(['me'], next);
      setCur('');
      setPw('');
      toast.success('Account updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!(await confirmDialog({ title: 'Delete your account?', body: 'Your playlists, likes, history and settings will be permanently deleted. Music sources you added stay on the server.', confirmLabel: 'Continue', danger: true }))) return;
    const password = window.prompt('Enter your password to confirm');
    if (!password) return;
    try {
      await api('/api/me', { method: 'DELETE', body: { password } });
      location.href = '/signup';
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const changing = email !== me.email || pw;
  return (
    <Section title="Account">
      <div className="grid gap-4 py-4 sm:grid-cols-2 md:py-0">
        <div>
          <Label htmlFor="acc-name">Display name</Label>
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="acc-email">Email</Label>
          <Input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="acc-new" hint="optional">New password</Label>
          <Input id="acc-new" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
        </div>
        {changing && (
          <div>
            <Label htmlFor="acc-cur">Current password</Label>
            <Input id="acc-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 md:pb-0">
        <span className="text-xs text-fg-3">{me.isAdmin ? 'You are the admin of this Aurora server.' : 'Member of this Aurora server.'}</span>
        <div className="flex gap-2">
          <Button variant="ghost" className="text-danger hover:bg-danger/10" onClick={() => void del()}>
            Delete account
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={name === me.name && !changing}>
            Save changes
          </Button>
        </div>
      </div>
    </Section>
  );
}

interface ServerInfo {
  urls: string[];
  current: string | null;
  secure: boolean;
  platform: string;
  tailscale: { installed: boolean; running: boolean; dnsName: string | null; httpsUrl: string | null; serveCommand: string };
}

function PhonePanel() {
  const { data, refetch, isFetching } = useQuery({ queryKey: ['server-info'], queryFn: () => api<ServerInfo>('/api/server-info'), staleTime: 15_000 });
  const ts = data?.tailscale;
  const copy = (t: string, what = 'Copied') => void navigator.clipboard?.writeText(t).then(() => toast.success(what), () => {});
  return (
    <div className="space-y-6 py-3.5 text-sm text-fg-2 md:py-0" data-testid="phone-panel">
      <div>
        <h3 className="mb-1 text-[15px] font-semibold text-fg">Anywhere — at home and away (recommended)</h3>
        {ts?.httpsUrl ? (
          <AddressCard url={ts.httpsUrl} note="Works on any network. Open it on your phone, then Share → Add to Home Screen for the full app with offline downloads." onCopy={copy} />
        ) : (
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li className={cn(ts?.installed && 'text-success')}>
              Install <b className="text-fg">Tailscale</b> on this computer{ts?.installed ? ' ✓' : ''} — free from tailscale.com/download.
            </li>
            <li>Install the Tailscale app on your phone and sign in with the <b className="text-fg">same account</b>.</li>
            <li className={cn(ts?.running && 'text-success')}>Make sure Tailscale is connected on both{ts?.running ? ' ✓' : ''}.</li>
            <li>
              On this computer, open a terminal (on Windows: Start → “Terminal”) and run:
              <button className="press mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left font-mono text-[13.5px] text-fg" onClick={() => copy(ts?.serveCommand ?? 'tailscale serve --bg 3000', 'Command copied')}>
                {ts?.serveCommand ?? 'tailscale serve --bg 3000'} <span className="font-sans text-[12px] text-fg-3">Copy</span>
              </button>
              <span className="mt-1 block text-[12.5px] text-fg-3">If it asks you to turn on HTTPS for your tailnet, follow the link it prints and run it again.</span>
            </li>
            <li>
              <button className="font-semibold text-accent" onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? 'Checking…' : 'Check again'}
              </button>{' '}
              — your private https:// address appears here with a QR code.
            </li>
          </ol>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-[15px] font-semibold text-fg">On your home Wi-Fi</h3>
        <p>Keep Aurora running, connect your phone to the same Wi-Fi and open:</p>
        {data?.urls.length ? (
          data.urls.slice(0, 2).map((u) => <AddressCard key={u} url={u} onCopy={copy} />)
        ) : (
          <p className="mt-2 text-fg-3">No Wi-Fi address found — is this computer connected to a network?</p>
        )}
        <p className="mt-2 text-[12.5px] text-fg-3">If the phone can’t connect, allow Node.js through Windows Firewall (“Private networks”) when Windows asks.</p>
      </div>
    </div>
  );
}

function AddressCard({ url, note, onCopy }: { url: string; note?: string; onCopy: (t: string, what?: string) => void }) {
  return (
    <div className="mt-2 flex items-center gap-4 rounded-[14px] bg-surface-2 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/qr?u=${encodeURIComponent(url)}`} alt={`QR code for ${url}`} className="size-24 shrink-0 rounded-lg bg-white p-1" />
      <div className="min-w-0">
        <button className="block max-w-full truncate font-mono text-[14px] font-semibold text-fg hover:underline" onClick={() => onCopy(url, 'Address copied')}>
          {url}
        </button>
        <p className="mt-1 text-[12.5px] text-fg-3">{note ?? 'Scan with your phone’s camera, or tap to copy.'}</p>
      </div>
    </div>
  );
}
