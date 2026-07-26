# web-ui — pm-jude 요청 인테이크 프론트

Next.js(App Router) + shadcn/ui 프론트엔드 ([ADR-0008](../docs/adr/0008-frontend-nextjs-shadcn.md)).
로직은 채널 비의존 코어 러너(백엔드)에 있고, 이 앱은 API 서버의 HTTP 계약만 소비한다.

## 사용 계약 — 전면 클라이언트 SPA (#26 스택 재검토로 추인)

이 앱은 Next를 **클라이언트 SPA 셸**로만 쓴다. Next의 AI 코딩 위험 축(암묵 캐싱,
서버/클라이언트 경계, 메이저 간 breaking)은 이 계약 아래에서 비활성이다:

- 페이지·컴포넌트는 `'use client'` — Server Components·Server Actions·Route Handlers 금지
- 데이터는 전부 `/api` 프록시(→ API 서버) 경유 — Next 서버에서의 fetch·DB 접근 금지
- `components.json`은 `rsc: false` — shadcn 생성물도 클라이언트 전용
- 이 계약을 깨는 변경은 ADR 개정을 동반해야 한다

## 실행

리포지토리 루트에서 한 번에:

```bash
pnpm dev                          # API 서버 + Next dev 동시 기동 — ANTHROPIC_API_KEY 필요
PMJUDE_FAKE_BACKEND=1 pnpm dev    # LLM 자격 증명 없이 (결정론 시나리오, 별도 DB)
```

http://localhost:3000 이 UI, http://127.0.0.1:8787 이 API다. 한쪽이 죽으면 같이 내려간다.
따로 띄우려면 `pnpm web`(API) / `pnpm web:ui`(UI).

API 서버 주소가 다르면 `PMJUDE_API_URL`로 프록시 대상을 바꾼다 (`next.config.ts`).

## 구조

- `app/page.tsx` — 화면 상태 머신: 인테이크 → 대기 → 명확화 마법사 → 문서/보류
- `components/` — 인테이크 폼·대기 카드·질문 마법사·문서 뷰·전사 (shadcn/ui는 `components/ui/`)
- `lib/` — API 클라이언트·답변 조립·문서 파서 (순수 로직, `pnpm --dir web-ui test`)

## 검사

```bash
pnpm --dir web-ui typecheck && pnpm --dir web-ui lint && pnpm --dir web-ui test && pnpm --dir web-ui build
```
