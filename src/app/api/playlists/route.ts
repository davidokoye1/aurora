import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { createPlaylist, listPlaylists } from '@/lib/server/user';
import { invalidateProfile } from '@/lib/server/recs/engine';

export const GET = route(async () => listPlaylists((await requireUser()).id));

const schema = z.object({ name: z.string().trim().max(120).default('New Playlist'), description: z.string().max(1000).default(''), trackIds: z.array(z.string()).max(5000).default([]) });

export const POST = route(async (req) => {
  const u = await requireUser();
  const input = schema.parse(await body(req));
  const pl = createPlaylist(u.id, input.name || 'New Playlist', input.description, input.trackIds);
  invalidateProfile(u.id);
  return pl;
});
