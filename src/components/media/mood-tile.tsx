'use client';

import Link from 'next/link';
import { mixColor } from './cards';

export function MoodTile({ mood }: { mood: { id: string; label: string; blurb: string; gradient: [string, string]; covers: string[] } }) {
  const bg = mixColor(mood.id);
  return (
    <Link href={`/mood/${mood.id}`} className="press group relative block aspect-[4/3] overflow-hidden rounded-[12px] p-3.5 text-[#111010]" style={{ background: bg }}>
      <div className="relative z-10 font-display text-[19px] font-extrabold leading-none md:text-2xl">{mood.label}</div>
      <div className="relative z-10 mt-1.5 line-clamp-2 max-w-[70%] text-[12px] leading-snug opacity-75">{mood.blurb}</div>
      {mood.covers[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mood.covers[0]} alt="" className="absolute -bottom-2 -right-3 size-[42%] rotate-[14deg] rounded-[6px] object-cover shadow-[0_8px_18px_rgba(0,0,0,0.35)]" />
      )}
    </Link>
  );
}
