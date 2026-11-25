import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aurora',
    short_name: 'Aurora',
    description: 'Your personal music streaming app.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#111010',
    theme_color: '#111010',
    categories: ['music', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Search', url: '/search' },
      { name: 'Downloads', url: '/downloads' },
      { name: 'Liked Songs', url: '/liked' },
    ],
  };
}
