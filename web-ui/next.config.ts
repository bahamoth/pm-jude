import type { NextConfig } from 'next';

// 웹 UI는 채널 어댑터(API 서버, pnpm web)의 프론트다 — /api는 전부 프록시한다 (ADR-0008).
const API_URL = process.env.PMJUDE_API_URL ?? 'http://127.0.0.1:8787';

/**
 * Next 16은 루프백 밖 origin이 요청하는 dev 리소스(`/_next`, `/__nextjs`)를 403으로 막는다.
 * 페이지 HTML은 검사 대상이 아니라서 「화면은 열리는데 폰트가 깨지고 HMR 소켓이 죽는」 형태로 드러난다.
 *
 * 기본은 차단을 유지한다 — 이 서버는 간이 식별만 있는 로컬 PoC이고 API 서버는 127.0.0.1 전용이다(ADR-0007).
 * 다른 기기에서 열어야 할 때만 호스트를 명시해 연다:
 *   PMJUDE_DEV_ORIGINS=172.20.11.245 pnpm dev
 */
const devOrigins = (process.env.PMJUDE_DEV_ORIGINS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
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
