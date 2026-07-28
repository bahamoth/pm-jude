# 개선 지표는 시스템이 스스로 쌓는 데이터로 구성한다 (ADR-0004 폐기)

> **EN** — The operator ruled (2026-07-28) that no historical data exists for improvement metrics: this org has no PM function and Linear issues are authored exclusively by developers, so the requester–developer clarification dialogue never reached the archive. ADR-0004's retrospective analysis is abandoned. All measurement becomes prospective, built on the version-attributed session data the system accumulates about itself.

운영자 판정(2026-07-28): 개선 지표로 활용할 백데이터가 없다고 간주한다. 이 조직에는 PM 직군이 없고 Linear 이슈는 개발자만 작성하므로, 요청자↔개발자 명확화 대화(재질문과 그 답)는 Linear 이전 단계(Slack·구두)에서 끝나 아카이브에 기록되지 않는다. ADR-0004의 전제 — 아카이브에 재질문 흔적이 남아 있다 — 가 이 조직에서 성립하지 않는다.

결정: ADR-0004(소급 아카이브 분석)를 폐기한다. §10의 자체 규칙 「베이스라인 없는 지표는 채택하지 않는다」에 따라 감소율 계열 지표(도입 전 대비 재질문·반려 감소율)를 폐기하고, 개선 루프와 지표는 이 시스템이 스스로 쌓는 데이터 — 버전 귀속 세션 데이터(F11), 게이트·판독 기록, F7 웹훅의 이슈 라이프사이클 신호 — 로만 구성한다.

측정 체계:

- **선행 지표 3종**(세션 중도 이탈율·재사용률·요청자 소요 시간) — 원설계대로 신규 측정. 영향 없음.
- **개선 판정** — 「도입 전 대비」가 아니라 버전 간 추이(vN 대비 vN+1). 초기 운영 구간이 자기 기준선이 된다.
- **§2.1 전제 검증** — 소급 실측을 런타임 슬롯 승격률 상시 관측으로 대체. §9 중단 기준 (c)의 입력도 동일 경로.
- **전향 대조(보조)** — provenance(ADR-0003) 가동 후, 롤아웃 강제 전 공존 구간에서 Jude 경유 이슈와 직행 이슈의 reopen·재질문 코멘트를 동시점 비교. 어떤 요청이 Jude를 타는지가 무작위가 아니므로(선택 편향) 방향 신호로만 쓴다.
- **필수 슬롯 최초 목록(F2e)** — 소급 분류표 대신 개발자 엘리시테이션 시드(`derivedFrom: developer-elicitation`)로 만들고, F2e의 기존 갱신 규칙(F11 재질문·reopen 신호 분기 점검, 미매핑 유형 = 스키마 결손)이 검증을 맡는다.

## Considered Options

- **Slack 아카이브 마이닝** — 요청의 실제 서식지라 소급 실측의 취지는 보존되지만, 대화가 비정형이고 프라이버시·접근 범위 문제가 있으며 신호량이 미검증이다. 채택하지 않되, 필요가 생기면 소규모 탐침 후 재검토.
- **개발자 엘리시테이션으로 베이스라인 수치 구성** — 기각. 회상 편향 탓에 분모로 쓸 수치의 신뢰가 서지 않는다. 수치가 아니라 슬롯 유형 목록의 시드로만 채택한다.

## Consequences

- 「도입 전보다 X% 개선」류의 절대 효과 증명은 포기한다. 가치 입증은 채택 신호(재사용률)·버전별 품질 추이·직접 결과 품질(검토 통과율, Jude 경유 이슈의 reopen)로 한다.
- #9 종결(won't-do). `src/analysis/` 도구(`pnpm retro`)는 코드로 남되 실행 계획이 없다.
- #10 언블록 — 슬롯 근거 소스를 엘리시테이션 시드 + 런타임 검증으로 재정의.
- #11 — #9 의존 제거. 남은 선행 조건은 실세션 데이터 확보뿐.
- PRD §2.1·§9·§10·F2e와 phase0-plan.md 갈래 B의 본문 개정 필요 — v1.4 문구가 소급 분석을 전제하므로 별도 지시로 진행.

출처: 운영자 지시 2026-07-28, PRD §2.1·§10, ADR-0003, ADR-0004.
