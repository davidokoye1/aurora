'use client';

const cache = new Map<string, string>();

/** Extract a vivid, readable dominant colour from an artwork URL (same-origin images only). */
export function dominantColor(url: string | null | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url)!);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const n = 24;
        c.width = n;
        c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, n, n);
        const d = ctx.getImageData(0, 0, n, n).data;
        let best: [number, number, number] = [120, 110, 200];
        let bestScore = -1;
        const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
          e.r += r; e.g += g; e.b += b; e.n++;
          buckets.set(key, e);
        }
        for (const e of buckets.values()) {
          const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max ? (max - min) / max : 0;
          const light = (max + min) / 510;
          const score = e.n * (0.3 + sat * 1.7) * (light > 0.12 && light < 0.85 ? 1 : 0.2);
          if (score > bestScore) {
            bestScore = score;
            best = [r, g, b];
          }
        }
        // keep it in a pleasant brightness band for gradients on dark UI
        let [r, g, b] = best;
        const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
        const target = Math.min(Math.max(l, 70), 170);
        const k = l ? target / l : 1;
        r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k);
        const hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
        cache.set(url, hex);
        resolve(hex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Curated, flat colours for generated covers (warm, muted — no neon, no gradients). */
export const MIX_COLORS = ['#ff5b2e', '#d9a23c', '#7f8f4e', '#5b7080', '#c4716a', '#3f5d8f', '#9a6a4f', '#6f6488', '#2f7d6d', '#b9893f'];
export function mixColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const m = /(\d+)\s*$/.exec(seed);
  return MIX_COLORS[(m ? Number(m[1]) - 1 : Math.abs(h)) % MIX_COLORS.length];
}
export function hashColor(s: string): string {
  return mixColor(s);
}
