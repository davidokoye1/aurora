import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { home } from '@/lib/server/home';

export const GET = route(async () => home((await requireUser()).id));
