---
status: accepted (2026-07-26)
---

# 웹 프론트엔드는 Next.js + shadcn/ui, pnpm workspace 멤버 `web-ui/`다

ARCHITECTURE.md 결정 대기 항목이던 웹 프레임워크를 확정한다(운영자 지시, 보드 #22). 프론트엔드는 시장 검증 프레임워크 Next.js(App Router)와 shadcn/ui 디자인 시스템으로 구축하고, 저장소에는 pnpm workspace 멤버 `web-ui/`로 추가한다.

근거: #16의 수제 인라인 HTML 웹 표면이 UX·UI 품질 미달로 판정됐다 — 명확화 질답은 객관식 중심 마법사 동선이어야 하고, LLM 대기 구간(최대 2분)은 진행 표시·비활성화·장기 대기 안내로 처리돼야 한다. 검증된 컴포넌트 체계 없이 이 수준을 유지하는 비용이 프레임워크 도입 비용을 넘는다.

구조: 백엔드는 단일 패키지 구조·tsconfig·CI 규칙 그대로 두고, `web-ui/`만 워크스페이스 멤버로 얹는다(#1 「pnpm workspace 없음」의 부분 개정 — 모노레포 전면 전환이 아니다). 기존 http 어댑터(`pnpm web`)는 API 서버로 유지되고 Next dev 서버가 `/api`를 프록시한다 — 채널 어댑터 경계(ADR-0007의 ChannelPort)는 변하지 않는다.

## Considered Options

- 수제 HTML 유지 + 스타일 보강: 기각 — 마법사 동선·대기 상태·접근성을 컴포넌트 체계 없이 손으로 유지하는 비용이 문제의 원인이다.
- Vite + React SPA: 기각 — 동급으로 검증됐지만 운영자가 Next를 지목했고, Phase 1 이후 서버 렌더링·라우팅 요구를 흡수할 여지가 크다.
- Next 풀스택 흡수(API Route Handlers로 웹 어댑터 대체): 기각 — 코어가 Next 런타임에 결합되고 검증된 HTTP 계약·테스트를 이식해야 한다. 어댑터는 얇게 유지한다.
- 단일 패키지 루트 동거: 기각 — Next의 tsconfig·빌드 요구가 백엔드 strict 규칙과 충돌해 예외가 늘어난다.
