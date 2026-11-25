import type { Metadata, Viewport } from 'next';
import { Archivo, Familjen_Grotesk } from 'next/font/google';
import './globals.css';

const ui = Archivo({ subsets: ['latin', 'latin-ext'], variable: '--font-ui', display: 'swap', axes: ['wdth'] });
const head = Familjen_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-head', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Aurora', template: '%s · Aurora' },
  description: 'Your personal music streaming app.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Aurora',
  appleWebApp: { capable: true, title: 'Aurora', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#111010',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${ui.variable} ${head.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
