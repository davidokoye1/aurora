import QRCode from 'qrcode';
import { requireUser } from '@/lib/server/auth';

/** QR code (SVG) for an Aurora address, so the phone can open it with its camera. */
export async function GET(req: Request) {
  await requireUser();
  const u = new URL(req.url).searchParams.get('u') ?? '';
  if (!/^https?:\/\/[^\s]{1,200}$/.test(u)) return new Response('Bad address', { status: 400 });
  const svg = await QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111010', light: '#ffffff' } });
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=3600' } });
}
