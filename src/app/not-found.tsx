import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <div className="font-display text-8xl font-extrabold text-accent">404</div>
      <h1 className="font-display text-2xl font-bold">This page skipped a beat</h1>
      <p className="max-w-sm text-sm text-fg-2">The page you’re looking for doesn’t exist or was moved.</p>
      <Link href="/" className="mt-2 rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg transition hover:scale-105">
        Back home
      </Link>
    </div>
  );
}
