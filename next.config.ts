import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.CDEK_RUNTIME === 'node' ? { output: 'standalone' } : {}),
};

export default nextConfig;
