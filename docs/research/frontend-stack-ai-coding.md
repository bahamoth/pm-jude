# AI 코딩 전제 프론트 스택 비교 (#26)

조사일 2026-07-26. 전제: AI 에이전트가 코드를 주로 작성하는 로컬 PoC — 요청자 인테이크 웹 UI, 백엔드 API 프록시 클라이언트, shadcn 계열 디자인 시스템, SSR 불필요, 로컬 단일 사용자, Phase 1 확장 여지. 후보: Next.js 16 App Router(현행) · Vite + React SPA · TanStack Start · React Router(구 Remix) · SvelteKit.

모든 주장은 해당 사실을 소유한 1차 출처(공식 문서·릴리스 노트·저장소 코드)로 추적했다. 1차 출처가 없는 「AI 코딩 적합성」 축은 [대리 지표](#방법--ai-코딩-적합성의-대리-지표)로 평가한 **판단**이며 본문에 판단임을 표기한다.

> 착지 주석(#34): 본문·표의 「feat/22 (브랜치)」 표기는 조사 시점의 위치 스냅샷이다 — 해당 브랜치는 이후 main에 병합됐고(PR #21), 인용 경로(`web-ui/`·`docs/adr/0008-frontend-nextjs-shadcn.md`)는 main에서 그대로 유효하다.

## 결론

**권고: 현행 Next.js 16 App Router 유지 + 「전면 클라이언트 SPA + `/api` 프록시」 사용 계약의 명문화** (ADR-0008 추인).

- 현행 `web-ui/`(feat/22 브랜치)는 이미 구축·동작 상태다. 페이지 전체가 `'use client'`이고 데이터는 `fetch` + `rewrites` 프록시로만 흐른다 — Next의 AI 코딩 위험 축(캐싱 의미론 변동, 서버/클라이언트 경계 오류)이 대부분 비활성인 사용 방식이다.
- shadcn/ui 1순위 지원 프레임워크이고, Vercel이 에이전트 워크플로우 도구(DevTools MCP, `create-next-app`의 AGENTS.md, `llms.txt` 문서 인덱스)를 1차로 제공한다.
- 유지 조건: 서버 기능(RSC 데이터 페칭, Server Actions, Cache Components)을 도입하지 않는 사용 계약을 `web-ui/` 문서에 명문화한다. 에이전트가 훈련 데이터의 서버 패턴을 습관적으로 끌어오는 드리프트가 주 위험이기 때문이다(판단).

**차선: Vite + React SPA.** 현행 컴포넌트가 전부 클라이언트 전용이라 이식 대상이 앱 셸 3파일(`layout.tsx`·`next.config.ts`·전역 CSS 배선)뿐이다 — 전환 비용이 낮게 유지되므로, Next 관례로 인한 에이전트 루프 낭비가 실제 관측되는 시점에 전환해도 늦지 않다. Phase 1에서 다중 라우트·서버 렌더링 요구가 실제로 생기면 그때 React Router v8 framework mode를 재평가한다.

탈락: TanStack Start(RC — 버전 유동), SvelteKit(shadcn 공식 미지원 + React 생태 이탈). 추가 후보는 없다 — Astro는 정적 콘텐츠 지향이라 상호작용 중심 인테이크 채팅과 요구가 어긋나고, Vite + TanStack Router 조합은 Vite + React SPA의 변형으로 해당 절에서 다룬다.

## 전제 상태 — 저장소 현행

| 항목 | 사실 | 출처 |
|---|---|---|
| 프레임워크 확정 | ADR-0008 accepted(2026-07-26): Next.js + shadcn/ui, pnpm workspace 멤버 `web-ui/`. Vite + React SPA는 「동급으로 검증됐지만 운영자가 Next를 지목」으로 기각 | `docs/adr/0008-frontend-nextjs-shadcn.md` (feat/22 브랜치) |
| 버전 | next 16.2.12 · react 19.2.4 · tailwindcss 4 · `@base-ui/react` 1.6 · shadcn CLI 4.15 · vitest 4 | `web-ui/package.json` (feat/22) |
| shadcn 구성 | style `base-nova`(Base UI 계열), `rsc: true` | `web-ui/components.json` (feat/22) |
| 렌더링 방식 | 단일 페이지 전체가 `'use client'` 상태 머신. localStorage 세션 복원, `lib/api.ts`의 `fetch`가 유일한 데이터 경로 | `web-ui/app/page.tsx` (feat/22) |
| 백엔드 연결 | `next.config.ts` `rewrites`로 `/api/*` → Node http 어댑터(`pnpm web`, 127.0.0.1:8787) 프록시. 채널 어댑터 경계(ADR-0007) 유지 | `web-ui/next.config.ts` (feat/22) |
| Next 결합 지점 | `app/layout.tsx`(Metadata·`next/font`)와 `next.config.ts` 2개 파일. `components/`·`lib/`는 Next 무결합 | `git grep "from 'next"` (feat/22) |
| 테스트 | `lib/document.test.ts`·`lib/wizard.test.ts` — 순수 로직 vitest. 컴포넌트·라우트 테스트 없음 | feat/22 트리 |

## 비교표

판단 축(AI 코딩 적합성·본 프로젝트 정합)은 대리 지표 기반 판단, 나머지는 1차 출처 사실.

| 축 | Next.js 16 App Router (현행) | Vite + React SPA | React Router v8 (framework) | TanStack Start | SvelteKit |
|---|---|---|---|---|---|
| AI 코딩 적합성 (판단) | 중상 — 훈련 데이터 최다이나 15→16 breaking(동기 `params` 제거, `middleware`→`proxy.ts` 등)으로 구세대 패턴 재현 위험. 벤더 에이전트 도구(MCP·AGENTS.md)로 상쇄 | 상 — 특수 파일·서버 경계 없음, 실패 표면 최소. 라우팅·데이터 관례는 직접 정의 필요 | 상 — 「boring major」 정책으로 훈련 데이터-현행 API 괴리 최소, 채택 규모 큼 | 중하 — RC 유동 + pre 릴리스 고빈도, 훈련 데이터 희소 | 하 — Svelte 5 문법 세대 교체 + React 대비 코퍼스 소수 |
| 타입 안정성 | `typedRoutes` stable(정적 타입 Link). 데이터 로딩 타입은 수동 | TS strict + zod 수동 구성(현 `lib/types.ts` 방식과 동일) | typegen — `.react-router/types`에 `Route.LoaderArgs`/`ComponentProps` 자동 생성(framework mode 한정) | 최상 — 라우터 전 구간 타입 추론(typed Link·params·search) | `$types.d.ts` 자동 생성 — `PageData`·load·params 타입 |
| 테스트 용이 | vitest 공식 가이드 有. 단 async Server Components는 vitest 미지원(공식) → 서버 기능 도입 시 E2E 강제. 현행 클라이언트 전용 사용에선 비해당 | vitest 네이티브(Vite 계열 동일 설정) | Vite 기반 — vitest 네이티브 | Vite 기반 — vitest 네이티브 | Vite 기반 — vitest 네이티브 |
| shadcn 호환 | 공식 1순위 템플릿 `next` | 공식 템플릿 `vite` | 공식 템플릿 `react-router` | 공식 템플릿 `start` | 공식 미지원 — 비공식 커뮤니티 포트(shadcn-svelte, Bits UI 기반) |
| 개발 루프 | `next dev`(Turbopack 기본·stable). 16.2에서 구동 ~400% 개선(공식 수치) | 번들 없이 즉시 구동 — 네이티브 ESM 온디맨드 서빙 + 의존성 프리번들 | Vite 플러그인(v8 최소 Vite 7) | Vite 플러그인 | Vite 플러그인 |
| 본 프로젝트 정합 (판단) | 최상 — 구축 완료·ADR 확정. 미사용 서버 기능의 관례 표면이 유일한 부채 | 상 — 요구 조건(SSR 불필요·단일 사용자·프록시 클라이언트)과 구조적으로 일치. 단 ADR-0008 번복 비용 | 중 — 현행 라우트 1개에 framework mode는 과잉. Phase 1 다중 라우트 시 재평가 | 하 — PoC에 RC 리스크를 질 이유 없음 | 최하 — 디자인 시스템 전제(shadcn 계열)와 충돌 |

## 방법 — AI 코딩 적합성의 대리 지표

「어느 프레임워크를 AI가 더 잘 짜는가」를 직접 측정한 1차 출처는 없다. 다음 검증 가능한 대리 지표로 평가했고, 이 절의 결론은 전부 판단이다.

1. **관례 표면과 특수 파일 수** — 프레임워크가 강제하는 파일 규약·지시어가 많을수록 에이전트의 실수 지점이 늘어난다. Next App Router: `page`/`layout`/`error`/`loading`/`route`/`proxy` 특수 파일 + `'use client'` 경계 + 캐싱 지시어. Vite SPA: `vite.config.ts` + `index.html` + 엔트리 1개.
2. **훈련 데이터-현행 API 괴리의 문서화된 규모** — 릴리스 노트의 breaking change 목록으로 검증 가능. Next 16은 동기 `params`·`cookies()` 접근 제거, `middleware.ts`→`proxy.ts`, 암묵 캐싱→opt-in 전환 등 목록이 길다([릴리스 노트](https://nextjs.org/blog/next-16)). React Router v8은 「It's not a major version if nothing broke. The breaking changes for v8 are quite minimal」을 공언하고 연 1회 major 주기를 채택했다([발표문](https://remix.run/blog/react-router-v8)). TanStack Start는 RC로 문서 자체가 버전 핀·계획된 업그레이드 작업을 권고한다([공식 문서](https://tanstack.com/start/latest)).
3. **벤더의 에이전트 도구 1차 지원** — Next.js: DevTools MCP(16), `create-next-app` AGENTS.md 동봉·브라우저 로그 포워딩(16.2), 문서 전체의 `llms.txt` 인덱스([16 릴리스](https://nextjs.org/blog/next-16), [16.2 릴리스](https://nextjs.org/blog/next-16-2)). shadcn: 공식 MCP 서버로 에이전트가 레지스트리 검색·설치([문서](https://ui.shadcn.com/docs/mcp)) — 이는 프레임워크 공통 이점.
4. **생태 규모(훈련 데이터 분포의 근사)** — React Router는 「nearly 11 million GitHub projects」·Shopify/GitHub/X.com/ChatGPT/Linear 채택([remix.run](https://remix.run/blog/wake-up-remix)). Next.js·React 코퍼스가 최대이고 Svelte는 소수라는 평가는 판단.

## 후보별 상세

### Next.js 16 App Router — 현행

- **버전·상태**: 16.0 릴리스 2025-10-21, 현행 16.2(2026-03-18). Turbopack이 dev·build 기본 번들러로 stable. App Router는 React canary 채널 사용. — [Next.js 16](https://nextjs.org/blog/next-16), [Next.js 16.2](https://nextjs.org/blog/next-16-2)
- **캐싱 모델 전환**: 16의 Cache Components는 「이전 App Router의 암묵 캐싱과 달리 전부 opt-in」 — 기본값이 요청 시 실행으로 바뀌었다. 훈련 데이터에 흔한 13~15 시절 암묵 캐싱 패턴과 현행 의미론이 다르다는 뜻이다. — [Next.js 16](https://nextjs.org/blog/next-16)
- **breaking 이력**: 동기 `params`·`searchParams`·`cookies()`·`headers()` 접근 제거(async 강제), `middleware.ts`→`proxy.ts` 개명(구명 deprecated), `next lint` 제거, `revalidateTag()` 시그니처 변경 등. — [Next.js 16 Breaking Changes](https://nextjs.org/blog/next-16#breaking-changes-and-other-updates)
- **타입 안전 라우팅**: `typedRoutes` stable — 정적 타입 Link. 데이터 로딩 계층의 자동 타입 생성은 없다. — [typedRoutes](https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes)
- **테스트**: vitest 공식 가이드가 「Since async Server Components are new to the React ecosystem, Vitest currently does not support them」으로 async 서버 컴포넌트를 제외하고 E2E를 권고. 동기·클라이언트 컴포넌트는 vitest로 커버 — 현행 전면 클라이언트 구성에선 제약 비해당. — [Vitest 가이드](https://nextjs.org/docs/app/guides/testing/vitest)
- **에이전트 도구**: DevTools MCP(라우팅·캐싱 지식, 통합 로그, 에러 자동 접근), 16.2의 AGENTS.md 동봉·브라우저 로그 포워딩·`next-browser`(experimental), `nextjs.org/docs/llms.txt`. — [Next.js 16](https://nextjs.org/blog/next-16#nextjs-devtools-mcp), [Next.js 16.2 AI](https://nextjs.org/blog/next-16-2)
- **shadcn**: 공식 1순위 설치 템플릿. — [설치 가이드](https://ui.shadcn.com/docs/installation)
- **판단**: 현행 사용 방식(전면 `'use client'` + 프록시)은 위 위험 축 중 캐싱·서버 경계를 구조적으로 비켜 간다. 위험은 「에이전트가 서버 패턴을 자발 도입」하는 드리프트 하나로 수렴하고, 이는 사용 계약 명문화로 관리 가능하다.

### Vite + React SPA

- **dev 서버 구동 방식**: 번들 기반 dev 서버는 「the entire application is bundled before it can be served」인 반면, Vite는 의존성 프리번들 + 네이티브 ESM 온디맨드 서빙으로 즉시 구동. 현행 Vite 8, Rolldown(Rust)으로 dev/prod 번들 일원화. — [Why Vite](https://vite.dev/guide/why)
- **프레임워크 부재의 대가**: React 공식 문서는 from-scratch 구성을 「It's a lot like building your own framework」로 규정 — 라우팅·데이터 페칭·코드 분할을 직접 선택해야 한다. 권장 프레임워크 목록은 Next.js(App Router)·React Router(v7)·Expo이고 TanStack Start는 Beta 표기. — [Creating a React App](https://react.dev/learn/creating-a-react-app)
- **shadcn**: 공식 템플릿 `vite`. — [설치 가이드](https://ui.shadcn.com/docs/installation)
- **본 건 적용 시**: 현행 앱은 라우트 1개·화면 상태 머신이라 라우터 자체가 불필요하다. 프록시는 Vite `server.proxy`가 `rewrites`와 등가. 테스트는 vitest 동일 계열이라 백엔드(vitest 4)와 설정 공유가 자연스럽다.
- **판단**: 실패 표면 최소(특수 파일·서버 경계·캐싱 지시어 전무)가 AI 코딩 축 최고점의 근거. 약점은 관례 부재 — 규모가 커지면 에이전트마다 다른 구조를 임의 발명하는 위험이 있고, 이는 프레임워크 관례가 대신 눌러 주던 부분이다.

### React Router v8 — 구 Remix 계보

- **Remix와의 관계**: 「Remix has always just been a layer on top of React Router」 — Remix v3로 계획되던 것이 React Router v7로 병합(2024-05 발표). — [Merging Remix and React Router](https://remix.run/blog/merging-remix-and-react-router)
- **이후 분기**: Remix v3는 React를 떠나 Preact 포크 기반 별도 프로젝트로 재출발(2025-05). React Router는 전담 팀·open governance로 독립 유지. — [Wake Up, Remix!](https://remix.run/blog/wake-up-remix)
- **v8 릴리스**: 2026-06-17. future flag 기본화로 「most boring」 major — breaking 최소, middleware 기본 탑재, ESM-only, 최소 요건 Node 22.22+/React 19.2.7+/Vite 7+. 연 1회 major 주기 채택. RSC는 opt-in unstable. — [React Router v8](https://remix.run/blog/react-router-v8)
- **타입 안전**: typegen이 라우트별 `.react-router/types/+types/*.d.ts`를 생성 — `Route.LoaderArgs`·`Route.ComponentProps`로 params·loaderData가 자동 타입. framework mode 한정. — [Type Safety](https://reactrouter.com/explanation/type-safety)
- **shadcn**: 공식 템플릿 `react-router`. — [설치 가이드](https://ui.shadcn.com/docs/installation)
- **판단**: 안정성 정책(보수적 major·플래그 선행 검증)이 훈련 데이터-현행 API 괴리를 구조적으로 줄이는, AI 코딩 관점에서 가장 유리한 릴리스 문화. 다만 라우트 1개인 현행 규모에서 framework mode(라우트 설정·loader 계층·typegen 빌드 단계)는 과잉이다. Phase 1에서 대시보드·매직링크 뷰어 등 다중 라우트 표면이 실제로 생기는 시점의 1순위 재평가 대상.

### TanStack Start

- **안정성**: RC — 「The RC API is considered stable and preparing for 1.0」. 프로덕션 체크리스트가 의존성 버전 핀과 「버전 범프를 계획된 작업으로 취급」을 권고. — [공식 문서](https://tanstack.com/start/latest)
- **릴리스 채널**: `@tanstack/react-start` 1.16x대 pre 릴리스가 일 단위로 이어지는 고빈도 채널. — [GitHub Releases](https://github.com/TanStack/router/releases)
- **구조**: TanStack Router 위에 서버 계층(`createServerFn`)을 얹은 형태. SSR 선택형 — 풀 문서 스트리밍·선택 렌더링·SPA 모드. — [공식 문서](https://tanstack.com/start/latest)
- **타입 안전**: 기반인 TanStack Router가 후보 중 최상 — 라우트 트리 전체를 추론으로 관통해 Link·params·search까지 타입 전파. — [Type Safety](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety)
- **shadcn**: 공식 템플릿 `start`. — [설치 가이드](https://ui.shadcn.com/docs/installation)
- **판단**: 타입 안정성 단독 1위이나, RC의 API 유동 + 훈련 데이터 희소(신생 + 고빈도 변경)는 AI 에이전트 주도 개발과 상성이 나쁘다. React 공식 문서의 Beta 표기도 같은 신호. 1.0 stable 이후 재평가 대상.

### SvelteKit

- **구조**: Svelte 컴파일러 + Vite 플러그인. SSR 기본, adapter로 SPA·정적 출력 전환. — [SvelteKit Introduction](https://svelte.dev/docs/kit/introduction)
- **타입 안전**: 라우트별 `$types.d.ts` 자동 생성 — `PageData`·load·params 타입. — [Generated Types](https://svelte.dev/docs/kit/types)
- **shadcn**: 공식 설치 가이드 목록에 없음. shadcn-svelte는 「An unofficial, community-led Svelte port of shadcn/ui」로 Bits UI 기반 — 본 프로젝트의 shadcn 계열 전제(ADR-0008, base-nova 스타일)와 컴포넌트 소스가 갈라진다. — [설치 가이드](https://ui.shadcn.com/docs/installation), [shadcn-svelte](https://shadcn-svelte.com/docs)
- **판단**: 프레임워크 품질과 무관하게 두 축에서 탈락 — (1) 디자인 시스템 전제 위반(공식 shadcn 레지스트리·MCP 미적용), (2) Svelte 5 runes 문법 세대 교체 + React 대비 소수 코퍼스로 AI 코딩 축 최하.

## shadcn/ui 지원 현황 — 공통 전제 검증

- 공식 설치 가이드의 지원 템플릿: 「`next`, `vite`, `start`, `react-router`, and `astro`」 + Laravel·수동 React. Svelte 부재. — [설치 가이드](https://ui.shadcn.com/docs/installation)
- 2026-07 변경: Base UI가 기본 primitive 라이브러리로 전환(Radix 계속 지원), React Aria 1급 추가, 스타일 8종(Vega·Nova·Maia·Lyra·Mira·Luma·Rhea·Sera). 현행 `web-ui`의 `base-nova` 스타일·`@base-ui/react` 의존은 이 최신 라인과 일치 — 현행 구성이 이미 shadcn 권장 최전선이다. — [Changelog](https://ui.shadcn.com/docs/changelog)
- 공식 MCP 서버: 에이전트(Claude Code·Cursor·VS Code·Codex)가 자연어로 레지스트리 컴포넌트를 검색·설치. React 계열 4개 후보 전체에 적용되는 공통 이점. — [MCP](https://ui.shadcn.com/docs/mcp)

## 현행 Next.js 유지 시 비용 / 교체 시 비용

### 유지 시 비용

1. **서버 패턴 드리프트 감시** — 에이전트가 훈련 데이터의 RSC 데이터 페칭·Server Actions·캐싱 패턴을 자발 도입하면 현행의 「위험 비활성」 구도가 무너진다. 완화: `web-ui/` README 또는 AGENTS.md에 사용 계약(전면 클라이언트 컴포넌트·데이터는 `lib/api.ts` 경유·서버 기능 금지) 명문화 + `components.json`의 `rsc` 플래그를 `false`로 정정. (문서 1건 + 설정 1줄)
2. **major 업그레이드 흡수** — 16의 breaking 목록이 보여주듯 Next는 major마다 이행 작업이 발생한다. 코드모드 제공(`@next/codemod`)으로 완화되나 반복 비용. — [Next.js 16](https://nextjs.org/blog/next-16)
3. **미사용 기능의 인지 부하** — SSR·캐싱·프록시 계층이 dev 스택에 상존. 16.2의 dev 구동 ~400% 개선으로 체감 비용은 축소. — [Next.js 16.2](https://nextjs.org/blog/next-16-2)

### 교체 시 비용 (→ Vite + React SPA 기준)

- **이식 그대로**: `components/`(shadcn ui 14개 + 도메인 4개), `lib/`(api·document·wizard·types + 테스트) — Next import 0건이라 무수정 이동.
- **재작성**: 앱 셸 — `app/layout.tsx`(Metadata·`next/font` → `index.html` + 폰트 로딩), `next.config.ts` rewrites → `vite.config.ts` `server.proxy`, `eslint-config-next` 제거. shadcn `components.json` 재초기화(공식 `vite` 템플릿).
- **비용 외 항목**: ADR-0008(2026-07-26 accepted) 번복 — 코드보다 결정 이력 비용이 크다. 현재 Next 기인 마찰이 관측된 바 없어 지금 교체는 순비용이다.
- **역방향 보험**: 위 결합도가 유지되는 한 전환 비용은 앞으로도 앱 셸 수준에 머문다. 「전면 클라이언트 + 프록시」 사용 계약은 유지 비용 완화이자 교체 옵션 보존 장치다.

## 출처

| 주제 | 1차 출처 |
|---|---|
| shadcn 지원 프레임워크 | <https://ui.shadcn.com/docs/installation> |
| shadcn Base UI 전환·스타일 8종 | <https://ui.shadcn.com/docs/changelog> |
| shadcn MCP 서버 | <https://ui.shadcn.com/docs/mcp> |
| shadcn-svelte 비공식 포트 | <https://shadcn-svelte.com/docs> |
| Next.js 16 릴리스·breaking | <https://nextjs.org/blog/next-16> |
| Next.js 16.2 릴리스·AI 개선 | <https://nextjs.org/blog/next-16-2> |
| Next.js typedRoutes | <https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes> |
| Next.js vitest 제약 | <https://nextjs.org/docs/app/guides/testing/vitest> |
| Vite dev 서버 구동 방식 | <https://vite.dev/guide/why> |
| React 공식 프레임워크 권장 | <https://react.dev/learn/creating-a-react-app> |
| Remix→React Router 병합 | <https://remix.run/blog/merging-remix-and-react-router> |
| Remix v3 분리·RR 독립 | <https://remix.run/blog/wake-up-remix> |
| React Router v8 릴리스 | <https://remix.run/blog/react-router-v8> |
| React Router typegen | <https://reactrouter.com/explanation/type-safety> |
| TanStack Start RC 상태 | <https://tanstack.com/start/latest> |
| TanStack Router 타입 안전 | <https://tanstack.com/router/latest/docs/framework/react/guide/type-safety> |
| TanStack 릴리스 채널 | <https://github.com/TanStack/router/releases> |
| SvelteKit 구조 | <https://svelte.dev/docs/kit/introduction> |
| SvelteKit 생성 타입 | <https://svelte.dev/docs/kit/types> |
| 현행 구현·ADR-0008 | 본 저장소 `feat/22-next-shadcn-frontend` 브랜치 (`web-ui/`, `docs/adr/0008-frontend-nextjs-shadcn.md`) |
