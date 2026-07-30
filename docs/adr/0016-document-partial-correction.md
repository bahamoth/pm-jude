---
status: accepted (2026-07-30)
---

# 문서는 상시 부분 교정된다 — 슬롯만의 함수가 아니다

> **EN** — Correction used to mean full regeneration: fixing one slot re-ran the completeness judgment and rebuilt the whole document, so satisfied sections could change or vanish (measured: a story present in v3 disappeared in v4). Correction was also locked once a session closed. Per operator directive (2026-07-30) the document becomes **continuously and partially** correctable: every element carries a stable address (`scope.inScope[2]`, `stories[4].acceptanceCriteria[1].ears`), a correction names one or more addresses plus optional quoted text, and it arrives either as a natural-language instruction (a prompt regenerates only the named elements) or as a direct replacement (applied deterministically, no LLM). Both produce vN+1 and record what changed, how, and on whose input. Principle 7 (document as single source of truth) holds; what changes is that the document is a function of slots **and** mockup back-injection **and** the requester's direct corrections — each of which lands as an utterance, so the evidence rule is preserved.

정정이 곧 전체 재생성이었다 — 슬롯 하나를 고치면 완결성 재판정을 거쳐 문서가 통째로 다시 만들어졌다. 만족한 부분이 바뀌거나 사라지는 것이 실측됐다(#64 A/B: v3에 있던 승인 워크플로 스토리가 v4에서 소실). 종결된 세션은 정정 자체가 막혀 있었다. 운영자 지시(2026-07-30): 문서는 끊임없이, 그리고 부분적으로 교정 가능해야 한다.

## 결정

**1. 문서 요소마다 안정적 주소를 둔다.** `problem`, `users[1]`, `scope.inScope[2]`, `stories[4].story`, `stories[4].acceptanceCriteria[1].ears`, `dataSources[0]`, `openIssues[2].question`. 이 주소가 정정의 좌표이자 렌더의 단위다 — 배열 항목을 문자열로 이어 붙이면 지목할 대상이 사라진다(가독성 문제와 같은 뿌리였다).

**2. 정정은 주소 집합 + 인용 텍스트로 지목한다.** 항목 클릭은 주소 하나, 드래그 선택은 선택 범위가 걸친 주소 집합과 인용 원문이 된다. 요소 경계를 넘는 선택을 허용한다 — 사람이 문서를 읽다 짚는 방식이 그렇다.

**3. 두 가지 정정 방식을 모두 지원한다.**
- **직접 편집** — 요청자가 쓴 대체 텍스트를 코드가 결정론적으로 적용한다. LLM을 거치지 않아 요청자가 쓴 문장이 그대로 남는다. 형식 검증(EARS·GWT)은 경고로만 — 요청자의 문장을 형식으로 막지 않는다.
- **자연어 지시** — 신설 프롬프트가 지목된 요소만 재생성한다. 문서 전체는 컨텍스트로 주되 **나머지 요소의 변경을 금지**한다. 이것이 전체 재생성과 갈리는 지점이다.

**4. 종결 잠금은 문서 정정에 적용하지 않는다.** 세션이 종결됐어도, 이슈가 생성됐어도 문서는 고칠 수 있다. 종결은 「이 대화의 진행이 끝났다」는 상태이고 문서의 정확성과는 다른 축이다.

**5. 두 방식 모두 vN+1을 만들고 변경 이력을 남긴다.** 대상 주소, 방식, 요청자 입력을 영속한다 — 무엇이 왜 바뀌었는지가 판독(F13)의 근거이고, 정정이 문서를 나아지게 했는지를 사후에 셀 수 있어야 한다.

## 원칙 7과의 관계

문서 단일 진실 원천은 그대로다. 바뀌는 것은 **문서가 슬롯만의 함수가 아니라는 것**이다 — 슬롯 정정, 목업 역주입(F4), 요청자의 직접 정정이 모두 문서를 갱신하는 입력이다. 근거 규율(근거는 대화·첨부뿐)은 유지된다: 요청자의 정정 입력 자체가 발화로 남아 근거가 되기 때문이다. 「요청자가 이렇게 고치라고 말했다」는 대화에 있는 사실이다.

## Consequences

- 슬롯 정정(전체 재판정 경로)은 남는다 — 요구의 **근거**가 바뀐 경우에는 재판정이 맞다. 문서 부분 정정은 **산출물의 표현·범위**가 문제인 경우의 경로다. 둘의 구분을 요청자에게 강요하지 않고, 화면에서 자연스럽게 갈라지도록 둔다.
- 직접 편집은 문서와 슬롯 상태의 정합이 어긋날 수 있다(슬롯은 그대로인데 문서 문장이 바뀜). 이 어긋남은 판독 대상이고, 정정 이력이 그 판단 근거다 — 조용히 덮지 않는다.
- 부분 재생성 프롬프트는 「나머지를 건드리지 않는다」를 지켜야 한다. 이를 회귀로 검증한다(지목 외 요소의 바이트 동일성).
