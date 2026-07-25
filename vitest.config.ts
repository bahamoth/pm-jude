import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    // better-sqlite3 네이티브 바인딩이 vitest 워커 fork 종료 시 크래시함 — 단일 워커에서 순차 실행
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
  },
});
