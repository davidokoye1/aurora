import fs from 'node:fs';
import path from 'node:path';
import { ART_DIR } from '@/lib/server/db';

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(name)) return new Response('Not found', { status: 404 });
  const file = path.join(ART_DIR, name);
  if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': MIME[name.split('.').pop()!], 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
