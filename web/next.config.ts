import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Pages: @cloudflare/next-on-pages でビルドするため
  // 各 route に `export const runtime = 'edge'` を追加すること
};

export default nextConfig;
