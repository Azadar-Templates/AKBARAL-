/** @type {import('next').NextConfig} */
const backend = process.env.NEXT_BACKEND_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: false,
  // Allow the sandbox preview host(s) to reach dev-mode resources (HMR)
  // so the proxied preview works from the browser.
  allowedDevOrigins: ['*.e2b.app'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
