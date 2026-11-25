import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { createUser, hashPassword, rateLimit, startSession, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { meOf } from '@/lib/server/user';
import { ensureMusicDirSource } from '@/lib/server/sources/manage';
import { startSync } from '@/lib/server/sync';
import { getServerSettings } from '@/lib/server/server-settings';

const schema = z.object({ email: z.string().email().max(200), name: z.string().trim().min(1).max(60), password: z.string().min(8).max(200) });

export const POST = route(async (req) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit('signup:' + ip, 10, 3600_000)) throw new HttpError(429, 'Too many sign-ups from this address. Try again later.');
  const input = schema.parse(await body(req));
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email);
  if (exists) throw new HttpError(409, 'An account with this email already exists.');
  const count = (db.prepare('SELECT count(*) c FROM users').get() as { c: number }).c;
  if (count > 0 && !getServerSettings().allowSignup) {
    throw new HttpError(403, 'New accounts are closed on this server. Ask the admin to turn on “Allow new accounts” in Settings.');
  }
  const user = createUser(input.email, input.name, await hashPassword(input.password));
  await startSession(user.id, req.headers.get('user-agent'));
  if (user.is_admin) {
    const src = ensureMusicDirSource();
    if (src) {
      startSync(src);
      (await import('@/lib/server/watch')).refreshWatchers();
    }
  }
  return meOf(user);
});
