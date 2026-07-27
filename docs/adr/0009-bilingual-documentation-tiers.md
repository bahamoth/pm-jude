---
status: accepted (2026-07-27)
---

# 문서 이중언어는 3단계 티어로 나눠 적용한다

> **EN** — Collaborators read English, the operator writes Korean. Full bilingual coverage of all 26,500 words would be a permanent tax on every future PR, so documentation is tiered instead: T1 keeps both languages canonical in paired files, T2 keeps a Korean body under an English summary block, T3 stays in whatever language it was written in. Tier assignment for new documents is specified in `docs/agents/bilingual.md`.

협업자가 영어권이므로 문서를 영어·한국어로 동시 지원한다(운영자 지시, 보드 #39). 다만 전면 이중화는 채택하지 않는다.

측정치: 저장소의 마크다운은 총 26,500단어이고 이 중 영어는 `AGENTS.md`·`docs/agents/*`의 약 1,500단어뿐이다. 전면 이중화는 지금 25,000단어를 번역하는 일회성 비용이 아니라 **앞으로 모든 문서 변경이 두 언어를 맞추는 영구 비용**이다. PRD는 논증이 촘촘해 기계 번역으로는 뉘앙스가 죽고, 한쪽이 뒤처지기 시작하면 어느 쪽이 맞는지 알 수 없게 된다. 유지되는 것은 티어가 명시되고 규칙으로 강제된 경우뿐이다.

| 티어 | 대상 | 형태 |
| --- | --- | --- |
| **T1** | `README`, `docs/persona/jude`, `CONTEXT.md` | 양쪽 정본. 짝 파일 `X.md`(en) / `X.ko.md`(ko), 같은 커밋에서 갱신. 용어집만 한 파일 병기 |
| **T2** | `PRD.md`, `docs/prd/*`, `ARCHITECTURE.md`, `docs/adr/*` | 한국어 본문 + 상단 영어 요약 블록 |
| **T3** | `docs/research/*`, `docs/ux/*`, `docs/phase0-plan.md`, `docs/data-model.md`, `web-ui/README.md` | 작성 언어 그대로 |

`AGENTS.md`와 `docs/agents/*`는 T1에서 제외하고 **영어 단일**로 둔다. 독자가 에이전트와 두 협업자뿐이라 한국어 짝을 만들어도 읽는 사람이 늘지 않는다.

`README.md`가 영어인 것은 GitHub 첫 화면이 영어권 협업자의 진입점이기 때문이다. 의미가 충돌하면 한국어를 정본으로 읽는다 — 논증이 한국어에서 발생하기 때문이며, 충돌 자체는 버그로 취급한다.

## Considered Options

- **전면 이중화**: 기각 — 위 비용. 그리고 동기화 이탈을 막을 장치가 없다.
- **영어 단일화(한국어 폐기)**: 기각 — 도메인 용어가 한국어로 정착해 있고(인테이크·승격·슬롯·재부상), 제품 자체가 한국어·영어 혼재 조직을 대상으로 한다(F2d, 금칙 모호어 사전이 두 언어를 모두 싣는다). 운영자의 사고 언어와도 어긋난다.
- **번역 자동화 후 검수**: 기각 — 검수 비용이 번역 비용과 다르지 않고, 자동 번역본이 정본으로 오인될 위험이 남는다.

## Consequences

T1 짝 파일은 헤딩 구조가 일치해야 한다. `scripts/check-bilingual-sync.mjs`가 이를 대조한다. **CI에는 붙이지 않는다** — 선례인 `check-arch-sync.mjs`도 수동 스크립트이고, 문서 동기화를 PR 게이트로 만들면 오탐이 착지를 막는다. 필요해지면 그때 승격한다.

T2의 영어 요약 블록은 번역본이 아니라 **요약**이다. 영어권 독자가 그 문서를 읽어야 하는지 판단할 수 있는 만큼만 담고, 상세는 한국어 본문에 남긴다. 요약과 본문이 어긋나면 본문이 정본이다.

새 문서를 만들 때 티어를 정하지 않으면 T3로 간주한다 — 기본값이 가장 싼 쪽이어야 규칙이 유지된다.
