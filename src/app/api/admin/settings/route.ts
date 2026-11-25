import { route, body } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { getServerSettings, saveServerSettings } from '@/lib/server/server-settings';

export const GET = route(async () => {
  await requireAdmin();
  return getServerSettings();
});

export const PUT = route(async (req) => {
  await requireAdmin();
  const { allowSignup } = await body<{ allowSignup?: boolean }>(req);
  return saveServerSettings({ allowSignup: !!allowSignup });
});
