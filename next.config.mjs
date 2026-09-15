/** @type {import('next').NextConfig} */
const backend = process.env.NEXT_BACKEND_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: false,
  // Compression is ON — the 178 KB application document and every other text
  // response used to travel uncompressed (≈550 KB per first visit).
  //
  // It was `false` until 2026-09-15 for a real reason: Next's bundled
  // `compression` middleware gzips proxied `text/event-stream` responses and
  // BUFFERS them, so the live execution stream arrived in one blob instead of
  // streaming (verified 2026-09-14: identity streams, gzip buffers to zero
  // bytes). The fix is not to disable compression globally but to make every
  // streaming response opt out of transforms: the middleware skips any
  // response whose `Cache-Control` carries `no-transform`. Both SSE producers
  // now send it (src/routes/realtime.ts, src/routes/models.ts) and
  // src/app/asset-delivery.test.ts asserts that invariant for every producer,
  // while `npm run smoke:shell` reads a live stream through this tier and
  // proves it still delivers incrementally.
  //
  // The three SPA text assets are additionally served brotli-encoded by
  // src/app/assets/[file]/route.ts (smaller than gzip; the middleware leaves
  // pre-encoded responses alone).
  compress: true,
  // Allow the sandbox preview host(s) to reach dev-mode resources (HMR)
  // so the proxied preview works from the browser.
  allowedDevOrigins: ['*.e2b.app'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
      // Realtime execution-log WebSocket (the browser client connects to the
      // same origin; SSE fallback rides on /api/* above).
      { source: '/ws/:path*', destination: `${backend}/ws/:path*` },
    ];
  },
  /**
   * Caching (page-load speed).
   *
   * Every asset and media file used to ship `Cache-Control: public, max-age=0`,
   * so each navigation re-downloaded the whole shell (≈550 KB) even though the
   * URLs carry the shared `?v=` version. These rules make repeat visits cheap:
   *  - the SPA documents stay fresh for a minute and then serve stale while
   *    revalidating (a deploy is picked up on the next navigation);
   *  - static media is cached for a week;
   *  - the compressed asset endpoint sets its own headers, this is belt-and-braces.
   * The SSE/API paths are untouched — no caching is added to /api.
   */
  async headers() {
    return [
      {
        source: '/',
        headers: [
          // The application shell must never be pinned by a shared cache: it
          // decides which screen exists at all, so a stale copy is a stale
          // product. `no-cache` still revalidates cheaply against the ETag
          // (304), and everything heavy is versioned + cached under /assets/*.
          { key: 'Cache-Control', value: 'private, no-cache, must-revalidate' },
        ],
      },
      {
        source: '/workspace', // the application entry — same rule as `/` above
        headers: [
          { key: 'Cache-Control', value: 'private, no-cache, must-revalidate' },
        ],
      },
      {
        source: '/media/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
};

export default nextConfig;
