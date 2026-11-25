import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { scheduleBackground } from '@/lib/server/background';

/** "Find missing artwork & info": retry online look-ups for albums still without a cover and artists without a photo. */
export const POST = route(async () => {
  const u = await requireUser();
  if (!u.is_admin) throw new HttpError(403, 'Only the server admin can do this.');
  const albums = db.prepare('UPDATE albums SET enriched_at = NULL WHERE cover IS NULL OR year IS NULL').run().changes;
  const artists = db.prepare('UPDATE artists SET enriched_at = NULL WHERE image IS NULL OR tags IS NULL').run().changes;
  scheduleBackground(200);
  return { albums, artists };
});
