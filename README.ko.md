<img src="web-ui/public/jude.svg" width="96" align="right" alt="Jude">

# PM Jude

English: [README.md](README.md)

AI PM 인테이크 레이어. 비개발자 스테이크홀더가 모호한 요청을 가져오면, Jude가 몇 가지 표적 질문으로 정리해 개발팀이 곧바로 착수할 수 있는 요구사항으로 넘긴다.

PM이 없는 팀에서는 요청이 개발자에게 직접 꽂힌다. 대개 완결성이 없고("대시보드 만들어줘") 무엇을·왜·어디까지가 빠져 있다. 그 비용은 해석·재질문·재작업으로 개발자가 치른다. PM Jude가 그 앞에 선다.

## 하는 일

**인테이크 → 명확화 → 문서 → 게이트.** 어느 채널로 들어오든 요청은 세션이 된다. 질문하기 전에 기존 이슈·과거 문서·종결 세션을 먼저 검색하므로, 조직이 이미 아는 것 위에서 질문이 만들어진다. 그다음 요청자의 언어로, 요청자의 업무 어휘로 표적 질문 3~5개. 모든 질문에는 「모르겠다」 경로가 함께 붙는다 — 답할 수 없는 요청자가 막다른 길에 서면 안 되기 때문이다.

완결성은 두 겹으로 판정한다. 필수 슬롯과 형식에 대한 결정론적 룰 검사, 그다음 남은 의미적 모호성에 대한 LLM 판정. 룰 층이 있는 이유는 LLM이 그냥 통과시키기 때문이다.

나오는 것은 `requirements` 문서다 — 문제 / 사용자 / 스코프 / EARS 수용기준을 갖춘 유저스토리 / 데이터 소스 / 오픈이슈. 아키텍처도 스택도 코드도 들어가지 않는다. *어떻게*는 개발자 몫이다.

설계가 붙들고 있는 성질 넷:

- **채널 비의존.** 코어는 웹도 Slack도 모른다. 어댑터가 하나의 코어 API만 호출한다.
- **고정 오케스트레이션.** 단계 전이는 손으로 쓴 상태 머신이 결정하고, LLM은 단계 안의 구조화 호출로만 존재한다. 하드 제약 — 승인 없는 이슈 생성 불가, 회신 없는 세션 종료 불가 — 은 프롬프트로 부탁하지 않고 코드로 강제한다.
- **코딩 비관여.** Jude는 요구를 정제하지 만들지 않는다.
- **1일차부터 계측.** 모든 세션이 프롬프트·모델·임계치·슬롯 스키마 버전에 귀속된다. 품질의 판정자가 내부 점수가 아니라 다운스트림 신호이기 때문이다.

요구사항 전문은 [PRD.md](PRD.md), 용어는 [CONTEXT.md](CONTEXT.md).

## 이름의 유래

「Hey Jude」, 그리고 PM이 이 제품이 대신하는 직군의 약어이자 폴 매카트니의 이니셜이기도 하다는 우연. 농담은 여기까지다 — 제품에 음악을 가리키는 것은 없고, 캐릭터는 실존 인물의 초상도 가사도 앨범 아트도 빌리지 않는다. Jude는 요청자가 말을 거는 상대다. 말하기 전에 듣고, 요청자가 답할 수 없는 것은 요청을 멈추는 대신 개발팀 몫으로 들고 가는 1인칭 동료. [docs/persona/jude.md](docs/persona/jude.md) 참조.

## 현재 상태

**Phase 0 — 개념 검증.** 정제 파이프라인이 로컬 웹 표면에서 끝까지 돈다. 문서 이후 단계는 아직 없다.

동작하는 것:

- 인테이크, 세션 영속, 세션 링크로 다른 브라우저에서 이어받기
- 컨텍스트 그라운딩 기반 명확화 루프 — 왕복 상한과 모든 질문의 「모르겠다」 경로
- 2층 완결성 판정, 슬롯 3상태(충족 / 미충족 / 승격)
- `requirements` 문서 생성, 요청자 언어로 하는 슬롯 단위 확인
- 보류(정보 부족)와 언제든 가능한 재개
- 전사·슬롯 상태·신호·버전 축을 훑는 세션 트레이스 뷰어
- 소급 Linear 아카이브 분석(베이스라인과 재질문 유형 분류표)

아직 없는 것:

- 승인 게이트, Linear 이슈 생성, 역보고
- UI 요청용 인터랙티브 목업
- 중복 병합, SLA 자동 백로그, 백로그 재부상
- 골든셋 회귀와 배포 게이트(`regressionPassed` 플래그는 있고 강제는 Phase 2)

Slack은 러너가 있고 제거가 아니라 봉인 상태다. Slack·Linear 프로비저닝이 운영자 의존이라 PoC를 막고 있어 웹 우선 검증을 택했다([ADR-0007](docs/adr/0007-web-first-verification.md)).

## 빠른 시작

Node 22 이상, pnpm 10. 저장소 루트에서:

```bash
pnpm install
cp .env.example .env      # ANTHROPIC_API_KEY 채우기
pnpm dev
```

`pnpm dev`가 API 서버와 Next dev 서버를 함께 띄운다. 한쪽이 죽으면 같이 내려간다. UI는 http://localhost:3000, API는 http://127.0.0.1:8787.

Anthropic 자격 증명이 없다면:

```bash
PMJUDE_FAKE_BACKEND=1 pnpm dev
```

별도 DB를 쓰는 결정론적 가짜 백엔드다. 전 구간을 걸어 보기에 충분하다.

API 루트는 **로컬 허브**를 겸한다 — [/board](http://localhost:3000/board) 이슈 보드, [/trace](http://localhost:3000/trace) 실시간 세션 트레이스, [/repo/docs/](http://localhost:3000/repo/docs/) 저장소 문서(마크다운·mermaid 렌더링). 전부 3000 포트에서도 열린다.

## 구성

```
src/
├── gateway/     LLM 게이트웨이 — complete(promptVersion, input) → structuredOutput
├── prompts/     버전 프롬프트 레지스트리. 버전은 불변
├── store/       SQLite 세션 저장소 (Drizzle)
├── runner/      채널 비의존 코어 러너 + 웹·Slack 어댑터
├── web/         API 서버와 로컬 허브
├── trace/       세션 트레이스 렌더러
├── analysis/    소급 아카이브 분석
└── cli/         intake · trace · retro · slack · web
web-ui/          Next.js App Router + shadcn/ui, 전면 클라이언트 SPA
```

`gateway/` 바깥은 어느 모델 백엔드를 쓰는지 모른다. `runner/` 바깥은 요청이 어느 채널에서 왔는지 모른다. 프롬프트 버전은 한 번 등록되면 변경되지 않으므로, 세션의 신호는 그 신호를 만든 바로 그 프롬프트에 계속 귀속된다.

다이어그램·상태 머신·ERD는 [ARCHITECTURE.md](ARCHITECTURE.md).

## 문서

| 문서 | 내용 |
| --- | --- |
| [PRD.md](PRD.md) | 제품 요구사항. 개요·원칙은 여기, 나머지 섹션은 [docs/prd/](docs/prd/) |
| [CONTEXT.md](CONTEXT.md) | 정본 용어집, 이중언어. 이 용어를 그대로 쓴다 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 시스템 구성도, 라이프사이클 상태 머신, 시퀀스, ERD |
| [docs/adr/](docs/adr/) | 아키텍처 결정 기록 |
| [docs/persona/jude.ko.md](docs/persona/jude.ko.md) | Jude가 누구이고 어떻게 말하고 어떻게 그려지는가 |
| [docs/ux/requester-journey.md](docs/ux/requester-journey.md) | 요청자 여정 UX 설계 |
| [AGENTS.md](AGENTS.md) | 이 저장소에서 에이전트가 일하는 방식 |

문서는 전부 번역하지 않고 티어로 나눠 이중언어를 적용한다 — [docs/agents/bilingual.md](docs/agents/bilingual.md).

## 개발

```bash
pnpm test          # vitest
pnpm typecheck
pnpm lint
pnpm format

pnpm --dir web-ui test
pnpm --dir web-ui build
```

CI가 모든 PR에서 위를 전부 돌린다. 두 스크립트는 의도적으로 CI에 넣지 않고 손으로 돌린다 — `node scripts/check-arch-sync.mjs`(mermaid 블록이 `docs/architecture.html`에 미러링됐는지)와 `node scripts/check-bilingual-sync.mjs`(T1 짝 문서).

작업은 `issues/index.html`의 로컬 단일 파일 보드에서 관리한다. JSON 데이터 아일랜드가 정본이고 렌더링된 페이지는 사람용이다. 한 지시 = 한 브랜치 = 한 PR, 직렬 착지. [docs/agents/workflow.md](docs/agents/workflow.md) 참조.
