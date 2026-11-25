import os from 'node:os';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { tailscaleInfo } from '@/lib/server/tailscale';

export const dynamic = 'force-dynamic';

/** Addresses for "Use it on your phone": home-Wi-Fi addresses and, if set up, the Tailscale HTTPS address. */
export async function GET(req: Request) {
  await requireUser();
  const port = Number(process.env.PORT || new URL(req.url).port || 3000);
  const addrs: string[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/tailscale|vethernet|docker|vmware|virtualbox|wsl/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('100.') && !a.address.startsWith('169.254.')) addrs.push(`http://${a.address}:${port}`);
  }
  const host = req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return NextResponse.json({
    urls: addrs,
    current: host ? `${proto}://${host}` : null,
    secure: proto === 'https',
    platform: process.platform,
    tailscale: await tailscaleInfo(port),
  });
}
