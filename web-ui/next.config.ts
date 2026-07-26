import type { NextConfig } from 'next';

// 웹 UI는 채널 어댑터(API 서버, pnpm web)의 프론트다 — /api는 전부 프록시한다 (ADR-0008).
const API_URL = process.env.PMJUDE_API_URL ?? 'http://127.0.0.1:8787';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      // 로컬 허브 (#36) — 운영자·개발팀 열람 표면도 3000에서 열리게 프록시
      { source: '/board', destination: `${API_URL}/board` },
      { source: '/trace', destination: `${API_URL}/trace` },
      { source: '/repo/:path*', destination: `${API_URL}/repo/:path*` },
    ];
  },
};

export default nextConfig;
