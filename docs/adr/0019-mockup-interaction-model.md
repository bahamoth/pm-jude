---
status: accepted (2026-08-02)
---

# 목업은 가리키고 골라서 다듬는다 — 텍스트 왕복의 병목 분해와 패턴 라이브러리의 역할 전환

> **EN** — Dogfooding raised two mockup hypotheses: text-based iteration will be too slow, and one-shot mockup proposals need an opinionated template library built from diverse user patterns. Grilling (2026-08-02, #68) decomposed the text-iteration bottleneck into four costs — (a) pointing at the target in words, (b) describing the desired change, (c) full-regeneration round-trips, (d) regressions from regeneration — and chose an interaction model that attacks each: **anchored comments** (click an element, comment lands with its selector — the ADR-0017 reopen-comment gains an anchor), **partial patches** (element-scoped regeneration; full regeneration reserved for structural change), and **structure-fork galleries** (2–3 variants to pick from at structural decision points, same spirit as the v1.7 theme pick — choosing beats describing, delegation path included). Direct manipulation (WYSIWYG) is rejected: it shifts design responsibility onto non-developer requesters. The template hypothesis is repurposed rather than pursued: with iteration cheap, one-shot accuracy stops being the goal (it depends on clarification quality F2, not templates), and the **pattern library** instead becomes infrastructure — the structure-layer vocabulary that makes partial patches reliable, supplies gallery variants, and reduces generation variance. Sources are public UI-pattern taxonomies adapted to F4 constraints; nothing is invented. Text-iteration slowness is still a prediction, not a measurement — F11 signals decide how far the library investment goes.

도그푸딩이 목업에 대해 가설 둘을 남겼다: 텍스트 기반 이터레이션은 생산성이 낮을 것이다(운영자 예측 — 실측 아님), 그리고 한방 목업 제안이 되려면 다양한 사용자 패턴 기반의 opinionated template이 필요하다. 그릴링(#68)에서 첫 가설의 병목을 분해했다:

- **(a) 대상 특정 비용** — 「왼쪽 위 그 버튼 말고 그 옆의…」를 말로 하는 비용
- **(b) 변경 서술 비용** — 원하는 것을 모를 때 말로 만들어내야 하는 비용
- **(c) 왕복 지연** — 전체 재생성 대기
- **(d) 재생성 회귀** — 재생성이 멀쩡한 부분을 망가뜨림

둘째 가설은 첫째의 해소로 전제가 무너진다. 이터레이션이 싸지면 초회 한방의 가치가 하락하고, 초회 정확도는 어차피 템플릿이 아니라 **명확화 품질(F2)**이 좌우한다. 그래서 템플릿은 폐기가 아니라 역할이 바뀐다 — 아래 결정 5.

## 결정

**1. 앵커 코멘트.** 요청자는 목업의 요소를 클릭해 **그 자리에** 코멘트를 남긴다. 코멘트는 요소 셀렉터·영역과 함께 기록되어 다음 판 생성에 실린다. ADR-0017의 「닫힌 판에 온 코멘트가 재개 요청이다」의 코멘트가 앵커를 얻는 것이며, 별도의 새 행동이 아니다. (a)의 해소.

**2. 부분 패치.** 앵커된 코멘트는 기본적으로 **해당 요소 단위의 재생성**으로 처리한다. 전체 재생성은 구조 변경 요청에 한정한다. (c)·(d)의 해소. 구조층/테마층 분리(v1.7)가 테마에 대해 보장한 것 — 「후보 간 차이가 그 축뿐임을 코드로 보장」 — 을 요소 축으로 확장하는 결정이다.

**3. 구조 분기 갤러리.** 구조적 분기(리스트-상세 vs 테이블 vs 카드 등)는 서술을 요구하지 않고 **변형 2~3안을 같은 데이터로 제시해 1택**하게 한다. 테마 선정(v1.7)과 같은 정신 — 선택이 서술을 이긴다. 「개발팀이 정하는 게 좋겠다」 위임 경로를 포함한다(승격과 같은 정신 — 답할 수 없는 선택을 강요하지 않는다). (b)의 해소.

**4. 직접 조작(WYSIWYG) 배제.** 요청자가 드래그·편집으로 직접 고치는 모델은 자유도가 최대지만, 비개발자·다국어 요청자에게 **설계 책임을 전가**한다. 요청자는 문제를 말하고 해석은 시스템이 한다는 역할 모델(페르소나·F2b)과 어긋나므로 채택하지 않는다.

**5. 패턴 라이브러리 — 역할 전환.** 「한방 제안용 opinionated template」 목표를 폐기하고, 패턴 라이브러리를 위 모델의 **기반 인프라**로 규정한다:

- **부분 패치의 구조 기반** — 자유 생성 HTML은 판마다 구조가 달라 요소 단위 패치가 불안정하다. 패턴 스켈레톤이 구조층의 어휘가 되어야 「이 요소만 재생성」이 신뢰 가능해진다.
- **갤러리 변형 공급원** — 구조 분기의 2~3안은 패턴 분류에서 나온다.
- **품질 분산 감소** — 초회 목업이 패턴 스켈레톤에서 출발해 세션 간 품질 편차를 줄인다.

소스는 공개 UI 패턴 분류(dashboard, list-detail, form wizard, settings, feed, board 등)와 공개 구현체를 F4 제약(self-contained HTML·레이아웃 단계 그레이스케일·구조층/테마 토큰 분리)에 맞게 **번안**한다 — 새로 발명할 것은 없다. 테마 레지스트리(v1.7)와 대칭인 **패턴 레지스트리**(내장 + 외부 등록)로 관리한다.

## Consequences

- F4 개정(v2.0): 반복 상호작용 항과 수용기준, 패턴 레지스트리. 상태 머신 전이는 변경 없음 — 목업 반복 단계 내부의 상호작용 변화다.
- 구조화 호출 ④(목업 HTML 생성)에 요소 단위 부분 패치 변형이 추가된다.
- 갤러리는 생성 비용을 늘린다 — 구조 분기 시점에 한정하고, 매 반복에 적용하지 않는다.
- 텍스트 왕복의 저생산성은 아직 예측이다. F11 신호(구간당 반복 수·소요 시간·앵커 코멘트 사용률·부분 패치 대 전체 재생성 비율)로 검증하며, **패턴 라이브러리의 투자 규모(초기 패턴 셋 범위)는 그 신호로 정한다**(§12 등재).
- 초기 패턴 셋이 없는 동안 부분 패치는 자유 생성 HTML 위에서 동작해야 한다 — 패치 실패(요소 특정 불가)는 전체 재생성 폴백과 F11 신호 기록을 갖는다.
