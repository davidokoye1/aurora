import crypto from 'node:crypto';
import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { getPlaylist } from '@/lib/server/user';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const pl = getPlaylist(u.id, id);
  const { kind = 'view' } = await body<{ kind?: 'view' | 'collab' }>(req).catch(() => ({ kind: 'view' as const }));
  if (kind === 'collab' && !pl.isOwner) throw new HttpError(403, 'Only the owner can invite collaborators.');
  const existing = db.prepare('SELECT token FROM share_links WHERE playlist_id = ? AND kind = ?').get(id, kind) as { token: string } | undefined;
  if (existing) return { token: existing.token, kind };
  const token = crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO share_links(token, playlist_id, kind, created_by, created_at) VALUES (?,?,?,?,?)').run(token, id, kind, u.id, now());
  if (kind === 'collab') db.prepare('UPDATE playlists SET collaborative = 1 WHERE id = ?').run(id);
  return { token, kind };
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const pl = getPlaylist(u.id, id);
  if (!pl.isOwner) throw new HttpError(403, 'Only the owner can revoke links.');
  const kind = new URL(req.url).searchParams.get('kind') ?? 'view';
  db.prepare('DELETE FROM share_links WHERE playlist_id = ? AND kind = ?').run(id, kind);
  return { ok: true };
});
