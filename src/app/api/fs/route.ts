import fs from 'node:fs';
import path from 'node:path';
import { route } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { list, places } from '@/lib/server/fsbrowse';

export const dynamic = 'force-dynamic';

/** Folder picker: without ?path → shortcuts and drives; with ?path → that folder's subfolders and audio count. Admin only, read-only. */
export const GET = route(async (req) => {
  const u = await requireUser();
  if (!u.is_admin) throw new HttpError(403, 'Only the server admin can browse folders on this computer.');
  const p = new URL(req.url).searchParams.get('path');
  if (!p) return { places: places() };
  if (!path.isAbsolute(p)) throw new HttpError(400, 'Path must be absolute.');
  if (!fs.existsSync(p)) throw new HttpError(404, 'That folder isn’t there any more — was a drive unplugged?');
  try {
    return list(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new HttpError(code === 'EACCES' || code === 'EPERM' ? 403 : 400, code === 'EACCES' || code === 'EPERM' ? 'Windows won’t let Aurora open this folder.' : (e as Error).message);
  }
});
