import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { resolveCopy, serveFile, serveUrl } from '@/lib/server/stream';
import { getSettings } from '@/lib/server/user';

export const dynamic = 'force-dynamic';

/** Streams a track with HTTP Range support. Falls back to other copies when one fails. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const prefer = (url.searchParams.get('q') as 'best' | 'smallest' | null) ?? getSettings(user.id).quality;
  const skip: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = await resolveCopy(id, { prefer, skip, copyId: attempt === 0 ? url.searchParams.get('copy') ?? undefined : undefined });
    if (!target) break;
    try {
      const res = target.kind === 'file' ? serveFile(target.path, target.mime, req) : await serveUrl(target, req);
      if (target.copy.failures) db.prepare('UPDATE track_copies SET failures = 0 WHERE id = ?').run(target.copy.id);
      return res;
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      db.prepare('UPDATE track_copies SET failures = failures + 1 WHERE id = ?').run(target.copy.id);
      skip.push(target.copy.id);
      console.warn('[stream] copy failed', target.copy.id, (e as Error).message);
    }
  }
  return new Response(JSON.stringify({ error: 'No playable copy of this track is reachable right now.' }), { status: 502, headers: { 'content-type': 'application/json' } });
}
