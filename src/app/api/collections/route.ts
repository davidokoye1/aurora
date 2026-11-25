import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db, now, uid } from '@/lib/server/db';

export const GET = route(async () => {
  const u = await requireUser();
  return db.prepare('SELECT c.id, c.name, c.color, c.created_at createdAt, (SELECT count(*) FROM collection_items i WHERE i.collection_id = c.id) count FROM collections c WHERE owner_id = ? ORDER BY c.name COLLATE NOCASE').all(u.id);
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const { name, color } = await body<{ name: string; color?: string }>(req);
  const id = uid();
  db.prepare('INSERT INTO collections(id, owner_id, name, color, created_at) VALUES (?,?,?,?,?)').run(id, u.id, (name ?? 'New Collection').trim().slice(0, 80) || 'New Collection', color ?? null, now());
  return { id };
});
