import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { db, now } from '@/lib/server/db';
import { assertCanEdit, getPlaylist } from '@/lib/server/user';
import { saveArt } from '@/lib/server/catalog';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  assertCanEdit(u.id, id);
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No image received.');
  if (file.size > 8 * 1024 * 1024) throw new HttpError(413, 'Images must be under 8 MB.');
  const url = saveArt(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!url) throw new HttpError(400, 'Use a JPEG, PNG, WebP or GIF image.');
  db.prepare('UPDATE playlists SET cover = ?, updated_at = ? WHERE id = ?').run(url, now(), id);
  return getPlaylist(u.id, id);
});
