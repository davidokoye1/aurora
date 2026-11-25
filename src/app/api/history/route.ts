import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { tracksByIds } from '@/lib/server/catalog';
import { invalidateProfile } from '@/lib/server/recs/engine';

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(500, Number(sp.get('limit') ?? 200));
  const before = Number(sp.get('before') ?? Date.now() + 1);
  const rows = db
    .prepare('SELECT id, track_id, ms_played, completed, skipped, context, created_at FROM play_events WHERE user_id = ? AND created_at < ? AND (ms_played >= 5000 OR completed = 1) ORDER BY created_at DESC LIMIT ?')
    .all(u.id, before, limit) as { id: number; track_id: string; ms_played: number; completed: number; skipped: number; context: string | null; created_at: number }[];
  const tracks = new Map(tracksByIds(u.id, [...new Set(rows.map((r) => r.track_id))]).map((t) => [t.id, t]));
  return rows.filter((r) => tracks.has(r.track_id)).map((r) => ({ id: r.id, playedAt: r.created_at, msPlayed: r.ms_played, completed: !!r.completed, skipped: !!r.skipped, context: r.context, track: tracks.get(r.track_id)! }));
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const id = new URL(req.url).searchParams.get('id');
  if (id) db.prepare('DELETE FROM play_events WHERE user_id = ? AND id = ?').run(u.id, Number(id));
  else db.prepare('DELETE FROM play_events WHERE user_id = ?').run(u.id);
  invalidateProfile(u.id);
  return { ok: true };
});
