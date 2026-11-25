import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { getSettings } from '@/lib/server/user';
import { invalidateProfile } from '@/lib/server/recs/engine';

const schema = z.object({
  trackId: z.string().min(1),
  msPlayed: z.number().int().min(0).max(86_400_000),
  completed: z.boolean().default(false),
  skipped: z.boolean().default(false),
  context: z.string().max(120).nullish(),
  duration: z.number().positive().max(86_400).optional(),
});

/** Listening events power history, stats and the taste profile. Private sessions record nothing. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const e = schema.parse(await body(req));
  if (e.duration) db.prepare('UPDATE tracks SET duration = ? WHERE id = ? AND (duration IS NULL OR abs(duration - ?) > 3)').run(e.duration, e.trackId, e.duration);
  if (getSettings(u.id).privateSession) return { recorded: false };
  if (e.msPlayed < 1000 && !e.skipped) return { recorded: false };
  if (!db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(e.trackId)) return { recorded: false };
  db.prepare('INSERT INTO play_events(user_id, track_id, ms_played, completed, skipped, context, created_at) VALUES (?,?,?,?,?,?,?)').run(
    u.id, e.trackId, e.msPlayed, e.completed ? 1 : 0, e.skipped ? 1 : 0, e.context ?? null, now(),
  );
  invalidateProfile(u.id);
  return { recorded: true };
});
