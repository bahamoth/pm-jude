---
status: accepted (2026-07-27)
---

# Jude의 목소리는 요청자 대면 표면에만 적용한다

> **EN** — Jude's persona voice applies only to surfaces a requester reads: the `clarification` prompt's question strings and the requester-facing UI copy. The `completeness` prompt (internal adjudication) is left unchanged, and the `requirements` document stays neutral. Jude writes the document, but does not write it like Jude.

제품에 Jude라는 인격을 도입하면서(보드 #38), 그 목소리가 닿는 범위를 세 표면 중 하나로 한정한다.

| 표면 | 결정 |
| --- | --- |
| `clarification` 출력 — `question`·`exampleOptions`·`dontKnowPath.label` | 적용 |
| `web-ui/` 요청자 대면 카피 | 적용 |
| `completeness` 출력 — `verdict`·`rationale`·`rubric` | 미적용 |
| `requirements` 문서 | 중립 유지 |

근거는 독자다. clarification의 세 필드는 요청자가 문자열 그대로 읽으므로 목소리가 존재하는 유일한 지점이다. completeness의 출력은 요청자에게 보이지 않는 내부 판정이며, 여기에 캐릭터 지시를 넣으면 얻는 것 없이 판정 분포만 흔들린다. `requirements`는 개발자가 읽고 **구현의 유일한 근거**다(원칙 7, [ADR-0002](0002-doc-single-source-of-truth.md)) — EARS 수용기준과 Given-When-Then에 캐릭터 말투가 섞이면 문서의 가치가 떨어진다. 중립성이 여기서는 자산이다.

운영자 최초 지시는 "정의·UI 카피·프롬프트 전부"였고, 위 반박을 제시한 뒤 이 범위로 확정됐다.

## Consequences

프롬프트 세 개 중 하나만 버전이 올라간다 — `clarification@0.2.0`. `completeness@0.1.0`과 `requirements@0.1.0`은 참조가 바뀌지 않으므로 이번 변경의 다운스트림 신호는 clarification 축에서만 해석하면 된다. 페르소나 도입이 완결성 판정 품질에 영향을 줬는지 따질 필요가 없다.

`requirements` 문서를 읽는 개발자는 Jude의 인격을 마주치지 않는다. 인격은 요청자 쪽에만 있고 게이트 이후로 넘어가지 않는다 — 승인 게이트가 톤의 경계이기도 하다.

반대 방향의 압력이 예상된다. 요청자 확인 화면(F3 슬롯 단위 확인)은 `requirements`의 값을 요청자에게 보여주는 지점이라 두 규칙이 만난다. 이 경우 **슬롯 값 자체는 문서 그대로 두고 감싸는 카피만 Jude의 목소리로** 쓴다. 값을 Jude 말투로 바꿔 쓰면 번역 무결성 장치가 깨진다.

정본 명세: [docs/persona/jude.md](../persona/jude.md).
