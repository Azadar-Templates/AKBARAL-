/** @type {import('next').NextConfig} */
const backend = process.env.NEXT_BACKEND_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
