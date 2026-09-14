/** @type {import('next').NextConfig} */
const backend = process.env.NEXT_BACKEND_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: false,
  // MUST stay false: Next's built-in gzip compression buffers proxied
  // streaming responses, which breaks text/event-stream (Server-Sent
  // Events) through the /api rewrite (verified 2026-09-14:
  // Accept-Encoding: identity streams,
  // gzip buffers to zero bytes, in dev AND `next start`). The SSE channel
  // is the realtime transport on free-tier hosts without WebSocket
  // proxying (AKBARAL_REALTIME_TRANSPORT=sse). Express applies no
  // compression of its own, so nothing double-compresses.
  compress: false,
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
};

export default nextConfig;
