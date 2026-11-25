import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentUser()) redirect('/');
  return (
    <div className="safe-top safe-bottom flex min-h-dvh items-start justify-center bg-bg px-5 py-10 sm:items-center">
      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  );
}
