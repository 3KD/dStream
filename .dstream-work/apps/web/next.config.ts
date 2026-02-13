import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@dstream/protocol"],
  turbopack: {
    root: path.join(__dirname, "../..")
  }
};

export default nextConfig;
