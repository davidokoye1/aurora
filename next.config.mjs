/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'ffmpeg-static', 'music-metadata', 'yauzl', 'cheerio', 'bcryptjs', 'playwright', 'strtok3'],
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  webpack(config, { dev }) {
    if (dev) {
      // The database, uploads and caches live under ./data — don't recompile when they change.
      config.watchOptions = { ...config.watchOptions, ignored: ['**/node_modules/**', '**/.git/**', '**/data/**', '**/data-*/**', '**/fixtures/**', '**/test-results/**'] };
    }
    return config;
  },
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
export default nextConfig;
