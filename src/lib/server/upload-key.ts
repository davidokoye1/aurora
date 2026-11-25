/** Normalised file name used to recognise a re-uploaded song (mirrors the sanitising in /api/upload). */
export function uploadKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/[^\p{L}\p{N}._ ()\[\]&,'-]+/gu, '_').slice(0, 120).toLowerCase();
}
