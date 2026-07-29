---
status: accepted (2026-07-29)
---

# 설정은 세 층이다 — 스키마 기본값 → 설정 파일 → 환경변수

> **EN** — Configuration was env-vars only, and inconsistently so: defaults duplicated across four CLI entrypoints, two documented env vars read by nothing. One deep module (`src/config.ts`, single `loadConfig()`) now layers zod-schema defaults, an optional `pm-jude.config.json` (path swappable via `PMJUDE_CONFIG`), and an explicit env-var mapping — env wins last, per operator directive. The real config file may hold API tokens and is therefore gitignored; only `pm-jude.config.example.json` is committed. A missing file is normal; a malformed file or unknown key refuses to boot — same philosophy as the unregistered-MIME rejection. Existing env var names are all preserved.

설정이 환경변수 단독이었고 그마저 일관되지 않았다 — 기본값이 엔트리포인트 4곳에 중복되고, `.env.example`이 문서화한 LLM 타임아웃·동시성 상한은 아무도 읽지 않는 죽은 설정이었다. 운영자 지시(2026-07-29): 기본 설정 → 통합 설정 파일 → 환경변수 주입 순서의 레이어드 설정.

## 결정

1. **겹침 순서는 기본값 → 파일 → env이고, env가 최종 우선이다.** 파일은 팀·환경의 정착된 설정을, env는 일회성 실행 주입(`PMJUDE_FAKE_BACKEND=1 pnpm dev` 류)을 맡는다 — env가 파일에 지면 이 관용구가 전부 죽는다.
2. **형식은 JSON, 실파일은 gitignore.** `pm-jude.config.json`은 API 토큰을 담을 수 있으므로 커밋하지 않고, 전체 키가 담긴 `pm-jude.config.example.json`만 커밋한다. 비밀은 파일·env 양쪽에서 받되 env가 우선한다.
3. **기본값의 단일 원천은 zod 스키마다.** 코드에 산재하던 상수(첨부 상한·압축 수치·발화 상한·왕복 상한 등)는 스키마 `.default()`로 승격되고, 모듈 상수는 스키마를 참조한다.
4. **미지 키와 형식 오류는 기동을 거부한다.** 오타 난 키가 조용히 무시되면 운영자는 설정이 반영됐다고 믿는다 — 미등록 MIME 명시 거부와 같은 철학. 파일 부재만 정상이다.
5. **기존 env var 이름은 전부 보존한다.** 이 결정은 층을 추가하는 것이지 이름을 바꾸는 것이 아니다.

## Consequences

- 죽은 설정 2종(`PMJUDE_LLM_TIMEOUT_MS`·`PMJUDE_LLM_MAX_CONCURRENCY`)이 게이트웨이 생성까지 배선되어 되살아난다 — 프롬프트별 상한(#56)의 전역 기본을 이제 설정으로 조정할 수 있다.
- 엔트리포인트는 `loadConfig()` 1회 호출로 수렴하고, 러너·서버 deps 시임은 변하지 않는다(값 주입 구조 유지).
- web-ui(Next)와 scripts는 범위 밖 — 백엔드 프로세스의 설정만 다룬다.
