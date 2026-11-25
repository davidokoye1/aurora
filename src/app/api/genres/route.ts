import { route } from '@/lib/server/api';
import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { genreFamiliesInLibrary } from '@/lib/server/recs/engine';

export const GET = route(async () => {
  await requireUser();
  const families = genreFamiliesInLibrary().map((f) => {
    return { id: f.id, label: f.label, color: f.color, count: f.count };
  });
  const raw = db.prepare('SELECT genre, count(*) c FROM tracks WHERE genre IS NOT NULL GROUP BY genre COLLATE NOCASE ORDER BY c DESC LIMIT 200').all();
  return { families, raw };
});
