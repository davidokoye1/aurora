import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { meOf } from '@/lib/server/user';
import { AppProviders, AppShell } from '@/components/layout/app-shell';

export const dynamic = 'force-dynamic';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const me = meOf(user);
  return (
    <AppProviders me={me}>
      <ThemeScript theme={me.settings.theme} accent={me.settings.accent} />
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}

function ThemeScript({ theme, accent }: { theme: string; accent: string }) {
  const js = `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.setProperty('--accent',${JSON.stringify(accent)});`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
