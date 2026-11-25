import 'server-only';
import { execFile } from 'node:child_process';
import fs from 'node:fs';

/**
 * Tailscale gives the computer a private HTTPS address (https://<pc>.<tailnet>.ts.net) that the phone can reach
 * at home and away — which also unlocks Add to Home Screen and offline downloads. We only read its status.
 */
export interface TailscaleInfo {
  installed: boolean;
  running: boolean;
  dnsName: string | null;
  /** HTTPS address if `tailscale serve` already points at Aurora. */
  httpsUrl: string | null;
  serveCommand: string;
}

const CANDIDATES = ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
let cache: { at: number; v: TailscaleInfo } | null = null;

function run(bin: string, args: string[]): Promise<string | null> {
  return new Promise((res) => {
    try {
      execFile(bin, args, { timeout: 3000, windowsHide: true }, (err, stdout) => res(err ? (stdout ? String(stdout) : null) : String(stdout)));
    } catch {
      res(null);
    }
  });
}

export async function tailscaleInfo(port: number): Promise<TailscaleInfo> {
  if (cache && Date.now() - cache.at < 20_000) return cache.v;
  const serveCommand = `tailscale serve --bg ${port}`;
  let v: TailscaleInfo = { installed: false, running: false, dnsName: null, httpsUrl: null, serveCommand };
  for (const bin of CANDIDATES) {
    if (bin.includes('\\') || bin.startsWith('/')) {
      if (!fs.existsSync(bin)) continue;
    }
    const out = await run(bin, ['status', '--json']);
    if (out == null) continue;
    v = { ...v, installed: true };
    try {
      const j = JSON.parse(out) as { BackendState?: string; Self?: { DNSName?: string } };
      v.running = j.BackendState === 'Running';
      v.dnsName = j.Self?.DNSName?.replace(/\.$/, '') || null;
    } catch {}
    if (v.running && v.dnsName) {
      const serve = await run(bin, ['serve', 'status', '--json']);
      if (serve && new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(serve)) v.httpsUrl = `https://${v.dnsName}`;
    }
    break;
  }
  cache = { at: Date.now(), v };
  return v;
}
