import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@dstream/protocol"],
  turbopack: {
    root: path.join(__dirname, "../..")
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/hls/:path*",
        destination: `${process.env.DSTREAM_HLS_PROXY_ORIGIN || 'http://mediamtx:8880'}/:path*`
      },
      {
        source: "/webrtc/:path*",
        destination: `${process.env.DSTREAM_WHIP_PROXY_ORIGIN || 'http://mediamtx:8889'}/:path*`
      }
    ];
  },
  generateBuildId: async () => {
    return `dstream-build-${Date.now()}`;
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
