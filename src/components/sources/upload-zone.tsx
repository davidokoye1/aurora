'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud, FolderUp, FileAudio, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { toast } from '@/stores/ui';
import { fmtBytes } from '@/lib/client/format';
import { api } from '@/lib/client/api';
import { useMounted } from '@/lib/client/hooks';

const AUDIO = /\.(mp3|m4a|mp4|m4b|aac|flac|ogg|oga|opus|webm|wav|wave|aif|aiff|wma|alac)$/i;

interface Item {
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'done' | 'error' | 'skipped';
  error?: string;
}

export function UploadZone() {
  const qc = useQueryClient();
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [phase, setPhase] = useState<'checking' | 'uploading' | null>(null);
  const ios = useMounted() && isIOS();
  const [skippedCount, setSkippedCount] = useState(0);

  const upload = async (list: { file: File; path: string }[]) => {
    const audio = list.filter((f) => AUDIO.test(f.file.name));
    if (!audio.length) {
      toast.error('No music files found in that selection.');
      return;
    }
    setItems(audio.map((a) => ({ name: a.path, size: a.file.size, status: 'pending' })));
    setPhase('checking');
    // 1. Skip songs Aurora already has (re-uploading a whole folder only sends what's new)
    let todo = audio;
    let skipped = 0;
    try {
      const hashes = await hashAll(audio.map((a) => a.file));
      const { have } = await api<{ have: boolean[] }>('/api/upload/check', { body: { items: audio.map((a, k) => ({ hash: hashes[k], name: a.file.name, size: a.file.size })) } });
      const dupNames = new Set(audio.filter((_, k) => have[k]).map((a) => a.path));
      skipped = dupNames.size;
      todo = audio.filter((a) => !dupNames.has(a.path));
      if (skipped) setItems((it) => it.map((x) => (dupNames.has(x.name) ? { ...x, status: 'skipped' } : x)));
    } catch {
      /* check is best-effort */
    }
    setSkippedCount(skipped);
    if (!todo.length) {
      setPhase(null);
      toast.success(skipped === 1 ? 'Already in your library' : `All ${skipped} songs are already in your library`);
      return;
    }
    // 2. Upload in small batches (a dropped connection only costs one batch), retrying each up to 3 times
    setPhase('uploading');
    const wake = await requestWakeLock();
    const total = todo.reduce((a, f) => a + f.file.size, 0);
    let sent = 0;
    setProgress({ sent, total });
    let ok = 0;
    const batches: (typeof todo)[] = [];
    let cur: typeof todo = [];
    let curSize = 0;
    for (const a of todo) {
      cur.push(a);
      curSize += a.file.size;
      if (curSize > 16 * 1024 * 1024 || cur.length >= 12) {
        batches.push(cur);
        cur = [];
        curSize = 0;
      }
    }
    if (cur.length) batches.push(cur);
    for (const batch of batches) {
      const size = batch.reduce((a, b) => a + b.file.size, 0);
      const names = new Set(batch.map((b) => b.path));
      setItems((it) => it.map((x) => (names.has(x.name) ? { ...x, status: 'uploading' } : x)));
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const fd = new FormData();
        for (const b of batch) {
          fd.append('files', b.file, b.file.name);
          fd.append('paths', b.path);
        }
        try {
          const res = await xhrUpload(fd, (loaded) => setProgress({ sent: sent + loaded, total }));
          const byName = new Map(res.results.map((r) => [r.name, r]));
          setItems((it) => it.map((x) => (names.has(x.name) ? { ...x, status: byName.get(x.name)?.ok ? 'done' : 'error', error: byName.get(x.name)?.error } : x)));
          ok += res.imported;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e as Error;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      if (lastErr) setItems((it) => it.map((x) => (names.has(x.name) ? { ...x, status: 'error', error: lastErr!.message } : x)));
      sent += size;
      setProgress({ sent, total });
    }
    void wake?.release().catch(() => {});
    setProgress(null);
    setPhase(null);
    toast.success(`${ok} ${ok === 1 ? 'song' : 'songs'} added${skipped ? ` · ${skipped} already in your library` : ''}`);
    void qc.invalidateQueries({ queryKey: ['sources'] });
    void qc.invalidateQueries({ queryKey: ['home'] });
    void qc.invalidateQueries({ queryKey: ['library'] });
  };

  const fromInput = (fl: FileList | null) => {
    if (!fl) return;
    void upload([...fl].map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name })));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (entries.length) {
      const out: { file: File; path: string }[] = [];
      await Promise.all(entries.map((en) => walk(en, '', out)));
      void upload(out);
    } else fromInput(e.dataTransfer.files);
  };

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error');

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn('flex flex-col items-center justify-center rounded-[18px] border-2 border-dashed px-6 py-12 text-center transition', over ? 'border-accent bg-accent/10' : 'border-line-strong')}
      >
        <UploadCloud className={cn('size-10 transition', over ? 'text-accent' : 'text-fg-3')} />
        <p className="mt-4 font-semibold">Choose songs to add</p>
        <p className="mt-1 text-sm text-fg-2">MP3, FLAC, M4A/AAC/ALAC, OGG/Opus, WAV and more. Tags and embedded artwork are read automatically.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" icon={<FileAudio className="size-4" />} onClick={() => files.current?.click()} disabled={!!phase}>
            Choose files
          </Button>
          {!ios && (
            <Button icon={<FolderUp className="size-4" />} onClick={() => folder.current?.click()} disabled={!!phase}>
              Choose a folder
            </Button>
          )}
        </div>
        <p className="mt-5 max-w-md text-[12.5px] text-fg-3">
          {ios
            ? 'Pick songs from the Files app (you can select many at once). Songs from Apple Music are copy-protected and can’t be added.'
            : 'Songs already in your library are skipped, so it’s safe to upload a whole folder again.'}
        </p>
        <input ref={files} type="file" multiple accept="audio/*,.flac,.m4a,.opus,.ogg,.wav,.aiff,.alac" className="hidden" onChange={(e) => fromInput(e.target.files)} />
        <input ref={folder} type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => fromInput(e.target.files)} />
      </div>
      {phase === 'checking' && <p className="mt-4 flex items-center gap-2 text-sm text-fg-2"><Loader2 className="size-4 animate-spin" /> Checking which songs are new…</p>}
      {progress && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(progress.sent / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <p className="mt-2 text-[13px] font-medium text-fg">
            Uploading {Math.min(items.length - skippedCount, done + 1)} of {items.length - skippedCount} songs · {fmtBytes(progress.sent)} of {fmtBytes(progress.total)}
          </p>
          <p className="mt-0.5 text-xs text-fg-3">Keep this screen open until it finishes — phones pause uploads when they lock.</p>
        </div>
      )}
      {!progress && items.length > 0 && (
        <div className="mt-4 rounded-xl bg-surface p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-success" /> {done} {done === 1 ? 'song' : 'songs'} added{skippedCount ? ` · ${skippedCount} already in your library` : ''}
          </p>
          {failed.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-danger">
              {failed.map((f) => (
                <li key={f.name} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {f.name}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function xhrUpload(fd: FormData, onProgress: (loaded: number) => void): Promise<{ imported: number; results: { name: string; ok: boolean; error?: string }[] }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/upload');
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      try {
        const j = JSON.parse(x.responseText);
        if (x.status >= 400) reject(new Error(j.error ?? `Upload failed (${x.status})`));
        else resolve(j);
      } catch {
        reject(new Error(`Upload failed (${x.status})`));
      }
    };
    x.onerror = () => reject(new Error('Network error during upload'));
    x.send(fd);
  });
}

async function walk(entry: FileSystemEntry, prefix: string, out: { file: File; path: string }[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, path: prefix + file.name });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      await Promise.all(batch.map((e) => walk(e, `${prefix}${entry.name}/`, out)));
    }
  }
}

/** Short content hash (first 16 hex of SHA-1, like the server) — only where the browser allows (HTTPS / localhost). */
async function hashAll(files: File[]): Promise<(string | undefined)[]> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return files.map(() => undefined);
  const out: (string | undefined)[] = [];
  for (const f of files) {
    if (f.size > 250 * 1024 * 1024) {
      out.push(undefined);
      continue;
    }
    try {
      const d = new Uint8Array(await subtle.digest('SHA-1', await f.arrayBuffer()));
      out.push([...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    return wl ? await wl.request('screen') : null;
  } catch {
    return null;
  }
}

function isIOS() {
  return typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
