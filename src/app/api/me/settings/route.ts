import { route, body } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { getSettings, saveSettings } from '@/lib/server/user';
import { DEFAULT_SETTINGS, type UserSettings } from '@/lib/types';

export const GET = route(async () => getSettings((await requireUser()).id));

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[];

export const PUT = route(async (req) => {
  const u = await requireUser();
  const input = await body<Partial<UserSettings>>(req);
  const clean: Partial<UserSettings> = {};
  for (const k of KEYS) if (k in input) (clean as Record<string, unknown>)[k] = input[k];
  if (clean.crossfade != null) clean.crossfade = Math.max(0, Math.min(12, Number(clean.crossfade) || 0));
  if (clean.eqBands) clean.eqBands = clean.eqBands.slice(0, 10).map((v) => Math.max(-12, Math.min(12, Number(v) || 0)));
  if (clean.accent && !/^#[0-9a-f]{6}$/i.test(clean.accent)) delete clean.accent;
  if (clean.enrichment && !u.is_admin) delete clean.enrichment;

  return saveSettings(u.id, clean);
});
