/** @type {import('next').NextConfig} */
const backend = process.env.NEXT_BACKEND_URL || 'http://127.0.0.1:4000';

// Low-memory production build (StackHost free plan: 512 MB RAM container).
//
// Measured 2026-09-19 on a clean tree — peak RSS of the whole process tree:
//   npm ci                                    ~325 MB
//   npx tsc -p tsconfig.backend.json          ~475 MB  (404 MB with a 384 MB heap cap)
//   npx next build --webpack                  ~668 MB  (build-time type check included)
//   npx next build (Turbopack default)       ~1284 MB
//   running stack (API + next-server)         ~336 MB
// Every untuned build phase therefore overshoots a 512 MB container on its own,
// which is what the platform reports as a failed install/build step. The
// runtime is comfortably inside the budget; only the build was not.
//
// AKBARAL_LOW_MEMORY_BUILD=1 (set only by the constrained deployment, see
// stackhost.yaml) skips the in-build type check, which alone peaked at ~475 MB.
// Nothing goes unchecked: the same types are enforced by `npm run typecheck`,
// the test suite and the docker-publish image build in CI, all of which run on
// machines with normal memory. The flag exists so a 512 MB host can produce a
// usable `.next/` instead of dying inside the type-check phase.
const lowMemoryBuild = process.env.AKBARAL_LOW_MEMORY_BUILD === '1';

const nextConfig = {
  reactStrictMode: false,
  ...(lowMemoryBuild ? { typescript: { ignoreBuildErrors: true } } : {}),
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
  // Dev-mode origin allowlist for Next's own dev resources (/_next/hmr, dev
  // chunks).
  //
  // BUG FIXED 2026-09-26: this list used to contain ONLY '*.e2b.app'. Listing
  // anything here REPLACES Next's implicit localhost default, so every browser
  // hitting the dev server on http://localhost:3000 or http://127.0.0.1:3000
  // got "Blocked cross-origin request to Next.js dev resource /_next/hmr".
  // The dev client then never finished hydrating, and because the SPA bundle
  // is injected by <Script strategy="afterInteractive"> (src/app/layout.tsx),
  // public/app.js was preloaded but NEVER EXECUTED — the browser showed the
  // static header/footer shell with every .screen hidden: no landing, no auth
  // card, no dashboard, no MASTER. curl looked healthy the whole time because
  // the API tier was fine; only a real browser reproduced it.
  //
  // Local hosts must therefore stay in the list alongside the sandbox preview
  // host. Asserted by src/app/dev-origins.test.ts.
  allowedDevOrigins: ['localhost', '127.0.0.1', '[::1]', '*.e2b.app', '*.app.github.dev', '*.gitpod.io'],
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
