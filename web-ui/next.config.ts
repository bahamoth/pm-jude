import type { NextConfig } from 'next';

// 웹 UI는 채널 어댑터(API 서버, pnpm web)의 프론트다 — /api는 전부 프록시한다 (ADR-0008).
const API_URL = process.env.PMJUDE_API_URL ?? 'http://127.0.0.1:8787';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
