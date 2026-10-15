import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
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
            key: "Content-Security-Policy",
            value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
          },
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
            value: "strict-origin-when-cross-origin",
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
        destination: "/api/hls/:path*"
      },
      {
        source: "/webrtc/:stream/whep/:path*",
        destination: "/api/whep/:stream/whep/:path*"
      },
      {
        source: "/webrtc/:stream/whip/:path*",
        destination: "/api/whip/:stream/whip/:path*"
      }
    ];
  },
  generateBuildId: async () => {
    return `dstream-build-${Date.now()}`;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
