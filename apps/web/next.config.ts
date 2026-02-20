import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/whip/:path*',
        destination: 'http://localhost:8889/:path*',
      },
      {
        source: '/api/hls/:path*',
        destination: 'http://localhost:8888/:path*',
      },
    ];
  },
};

export default nextConfig;
