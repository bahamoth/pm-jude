import { defineConfig } from 'vitest/config';

// 순수 로직(lib/)만 노드 환경에서 검사한다 — 컴포넌트 렌더링 검증은 브라우저 실검증 몫.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
