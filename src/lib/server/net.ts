import 'server-only';
import { EnvHttpProxyAgent, Agent, fetch as ufetch, type Dispatcher } from 'undici';

/**
 * Proxy-aware HTTP client used for every outbound request (source crawling, metadata, streaming).
 * Honours HTTPS_PROXY/HTTP_PROXY/NO_PROXY, follows redirects manually (keeping cookies),
 * retries with backoff on 429/5xx, and enforces per-source concurrency and politeness delay.
 */
const g = globalThis as unknown as { __auroraDispatcher?: Dispatcher };
function dispatcher(): Dispatcher {
  if (!g.__auroraDispatcher) {
    const hasProxy = !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
    g.__auroraDispatcher = hasProxy
      ? new EnvHttpProxyAgent({ connect: { timeout: 20_000 }, headersTimeout: 30_000, bodyTimeout: 120_000 })
      : new Agent({ connect: { timeout: 20_000 }, headersTimeout: 30_000, bodyTimeout: 120_000 });
  }
  return g.__auroraDispatcher;
}

export const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Aurora/1.0';

export interface AccessOptions {
  headers?: Record<string, string>;
  username?: string;
  password?: string;
  delayMs?: number;
  concurrency?: number;
  retries?: number;
}

export interface FetchResult {
  url: string; // final URL after redirects
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  res: Response;
}

class Semaphore {
  private q: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.q.push(r));
    this.active++;
  }
  release() {
    this.active--;
    const n = this.q.shift();
    if (n) n();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  private cookies = new Map<string, Map<string, string>>();
  private sem: Semaphore;
  private lastRequest = 0;
  constructor(public opts: AccessOptions = {}) {
    this.sem = new Semaphore(Math.max(1, Math.min(16, opts.concurrency ?? 4)));
  }

  private buildHeaders(url: URL, extra?: Record<string, string>) {
    const h: Record<string, string> = {
      'user-agent': DEFAULT_UA,
      accept: '*/*',
      'accept-language': 'en;q=0.9,*;q=0.5',
    };
    for (const [k, v] of Object.entries(this.opts.headers ?? {})) if (v) h[k.toLowerCase()] = v;
    if (this.opts.username) {
      h['authorization'] = 'Basic ' + Buffer.from(`${this.opts.username}:${this.opts.password ?? ''}`).toString('base64');
    }
    const jar = this.cookies.get(url.host);
    if (jar?.size) {
      const existing = h['cookie'] ? h['cookie'] + '; ' : '';
      h['cookie'] = existing + [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return { ...h, ...(extra ?? {}) };
  }

  private storeCookies(url: URL, headers: Headers) {
    const raw = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (!raw.length) return;
    const jar = this.cookies.get(url.host) ?? new Map();
    for (const c of raw) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    this.cookies.set(url.host, jar);
  }

  /** Low-level request. Caller must consume or cancel the body. */
  async request(
    input: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; noRetry?: boolean; noThrottle?: boolean } = {},
  ): Promise<FetchResult> {
    const retries = init.noRetry ? 0 : (this.opts.retries ?? 2);
    let attempt = 0;
    for (;;) {
      if (!init.noThrottle) await this.sem.acquire();
      try {
        if (!init.noThrottle && this.opts.delayMs) {
          const wait = this.lastRequest + this.opts.delayMs - Date.now();
          if (wait > 0) await sleep(wait);
          this.lastRequest = Date.now();
        }
        let url = new URL(input);
        for (let hop = 0; hop <= 10; hop++) {
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported protocol ${url.protocol}`);
          const res = (await ufetch(url, {
            method: init.method ?? 'GET',
            headers: this.buildHeaders(url, init.headers),
            body: init.body,
            redirect: 'manual',
            signal: init.signal ?? AbortSignal.timeout(60_000),
            dispatcher: dispatcher(),
          })) as unknown as Response;
          this.storeCookies(url, res.headers);
          if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            await res.body?.cancel().catch(() => {});
            url = new URL(res.headers.get('location')!, url);
            continue;
          }
          if ((res.status === 429 || res.status >= 500) && attempt < retries) {
            await res.body?.cancel().catch(() => {});
            const ra = Number(res.headers.get('retry-after'));
            throw Object.assign(new Error(`HTTP ${res.status}`), { retryAfter: Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0 });
          }
          return { url: url.toString(), status: res.status, headers: res.headers, body: res.body, res };
        }
        throw new Error('Too many redirects');
      } catch (e) {
        const err = e as Error & { retryAfter?: number; name?: string };
        if (err.name === 'AbortError' && init.signal?.aborted) throw e;
        if (attempt >= retries) throw e;
        attempt++;
        await sleep(err.retryAfter || 500 * 2 ** attempt);
      } finally {
        if (!init.noThrottle) this.sem.release();
      }
    }
  }

  async text(url: string, maxBytes = 8 * 1024 * 1024): Promise<{ url: string; status: number; headers: Headers; text: string; bytes: Uint8Array }> {
    const r = await this.request(url, { headers: { accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8' } });
    const bytes = await readLimited(r.body, maxBytes);
    return { url: r.url, status: r.status, headers: r.headers, bytes, text: decodeText(bytes, r.headers.get('content-type')) };
  }

  /** Fetch the first `n` bytes of a resource using Range (falls back to truncating a full response). */
  async head(url: string, n = 4096): Promise<{ url: string; status: number; headers: Headers; bytes: Uint8Array; total: number | null; ranged: boolean }> {
    const r = await this.request(url, { headers: { range: `bytes=0-${n - 1}` } });
    const bytes = await readLimited(r.body, n);
    let total: number | null = null;
    const cr = r.headers.get('content-range');
    if (cr) {
      const m = /\/(\d+)/.exec(cr);
      if (m) total = Number(m[1]);
    } else if (r.headers.get('content-length')) total = Number(r.headers.get('content-length'));
    return { url: r.url, status: r.status, headers: r.headers, bytes, total, ranged: r.status === 206 };
  }

  async json<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const r = await this.request(url, { headers: { accept: 'application/json', ...(headers ?? {}) } });
    const bytes = await readLimited(r.body, 64 * 1024 * 1024);
    if (r.status >= 400) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
}

export async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.length) break;
  }
  return out;
}

/** Decode bytes honouring the HTTP charset, a <meta charset>, or a BOM; falls back to windows-1252 when UTF-8 is invalid. */
export function decodeText(bytes: Uint8Array, contentType: string | null): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) charset = 'utf-8';
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be';
  }
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? /encoding=["']([\w-]+)/i.exec(head)?.[1];
  }
  try {
    if (charset && charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'utf8') {
      return new TextDecoder(charset).decode(bytes);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/** A shared client for metadata APIs (MusicBrainz etc.) with an honest UA and 1 req/s. */
const metaClients = new Map<string, HttpClient>();
export function metaClient(host: string, delayMs: number) {
  let c = metaClients.get(host);
  if (!c) {
    c = new HttpClient({ concurrency: 1, delayMs, headers: { 'user-agent': 'Aurora/1.0 (self-hosted personal music player)' } });
    metaClients.set(host, c);
  }
  return c;
}
