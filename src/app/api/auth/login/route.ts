import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { rateLimit, startSession, verifyPassword, HttpError, type User } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { meOf } from '@/lib/server/user';

const schema = z.object({ email: z.string().min(1).max(200), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const input = schema.parse(await body(req));
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit('login:' + ip, 20, 15 * 60_000) || !rateLimit('login:' + input.email.toLowerCase(), 8, 15 * 60_000)) {
    throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  }
  const row = db.prepare('SELECT id,email,name,is_admin,created_at,password_hash FROM users WHERE email = ?').get(input.email.trim()) as (User & { password_hash: string }) | undefined;
  if (!row || !(await verifyPassword(input.password, row.password_hash))) throw new HttpError(401, 'Incorrect email or password.');
  const { password_hash: _p, ...user } = row;
  await startSession(user.id, req.headers.get('user-agent'));
  return meOf(user);
});
