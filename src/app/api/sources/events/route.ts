import { requireUser } from '@/lib/server/auth';
import { syncEvents } from '@/lib/server/sync';
import type { SyncProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Server-sent events: live sync progress for all sources. */
export async function GET(req: Request) {
  try {
    await requireUser();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      const send = (sourceId: string, p: SyncProgress) => {
        try {
          ctl.enqueue(enc.encode(`event: progress\ndata: ${JSON.stringify({ sourceId, progress: p })}\n\n`));
        } catch {}
      };
      const ping = setInterval(() => {
        try {
          ctl.enqueue(enc.encode(`: ping\n\n`));
        } catch {}
      }, 20_000);
      syncEvents.on('progress', send);
      ctl.enqueue(enc.encode(`retry: 3000\n\n`));
      cleanup = () => {
        clearInterval(ping);
        syncEvents.off('progress', send);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          ctl.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
