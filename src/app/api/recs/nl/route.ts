import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { generateFromPrompt } from '@/lib/server/recs/nl';
import { getSettings } from '@/lib/server/user';

export const POST = route(async (req) => {
  const u = await requireUser();
  const { prompt } = await body<{ prompt: string }>(req);
  if (!prompt?.trim()) throw new HttpError(400, 'Describe the playlist you want.');
  return generateFromPrompt(u.id, prompt.slice(0, 300), getSettings(u.id).explicitFilter);
});
