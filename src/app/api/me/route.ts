import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { requireUser, hashPassword, verifyPassword, endSession, HttpError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { meOf } from '@/lib/server/user';

export const GET = route(async () => meOf(await requireUser()));

const patch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  email: z.string().email().max(200).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

export const PATCH = route(async (req) => {
  const u = await requireUser();
  const input = patch.parse(await body(req));
  if (input.newPassword || (input.email && input.email !== u.email)) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id) as { password_hash: string };
    if (!input.currentPassword || !(await verifyPassword(input.currentPassword, row.password_hash))) throw new HttpError(403, 'Your current password is incorrect.');
  }
  if (input.email && input.email !== u.email) {
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(input.email, u.id)) throw new HttpError(409, 'That email is already in use.');
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(input.email, u.id);
  }
  if (input.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(input.name, u.id);
  if (input.newPassword) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(input.newPassword), u.id);
  }
  return meOf({ ...u, name: input.name ?? u.name, email: input.email ?? u.email });
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const { password } = (await body<{ password?: string }>(req)) ?? {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id) as { password_hash: string };
  if (!password || !(await verifyPassword(password, row.password_hash))) throw new HttpError(403, 'Password is incorrect.');
  await endSession();
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  const admins = (db.prepare('SELECT count(*) c FROM users WHERE is_admin = 1').get() as { c: number }).c;
  if (!admins) db.prepare('UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1)').run();
  return { ok: true };
});
