import type { Artist, Track } from './types';

export interface Stats {
  minutes: number;
  plays: number;
  skips: number;
  distinctArtists: number;
  distinctTracks: number;
  topTracks: { track: Track; plays: number; minutes: number }[];
  topArtists: { artist: Artist; plays: number; minutes: number }[];
  topGenres: { id: string; label: string; plays: number; share: number }[];
  hours: number[];
  weekdays: number[];
  months: number[];
  streak: number;
  bestStreak: number;
  topDay: { date: string; minutes: number } | null;
  firstTrack: Track | null;
  peakHour: number | null;
  persona: { title: string; blurb: string } | null;
  activeDays: number;
}
