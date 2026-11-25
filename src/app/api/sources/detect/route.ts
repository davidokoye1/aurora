import { z } from 'zod';
import { route, body } from '@/lib/server/api';
import { requireUser, HttpError } from '@/lib/server/auth';
import { detectSource } from '@/lib/server/sources/detect';
import { configSchema } from '@/lib/server/sources/schema';

const schema = z.object({ url: z.string().min(3).max(4000), config: configSchema.default({}) });

export const POST = route(async (req) => {
  await requireUser();
  const input = schema.parse(await body(req));
  try {
    return await detectSource(input.url, input.config);
  } catch (e) {
    throw new HttpError(422, (e as Error).message || 'Could not read that URL.');
  }
});
