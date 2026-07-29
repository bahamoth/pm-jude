---
status: accepted (2026-07-29) — ADR-0011 Consequences의 「요약 압축 금지」 조항을 생성 호출 한정으로 개정
---

# 장문 소스 규율 — 판정에는 전문, 생성에는 압축본

> **EN** — A 134k-char pasted source made `requirements` generation exceed even its 300s cap (2026-07-29), because generation output scales with source size while judgment output scales with slot count (completeness succeeded in 75s on the same source). The discipline is therefore stage-dependent: judgment calls (clarification, completeness, promotion) always receive full extracted text; generation calls (requirements, back-injection) receive a condensed rendition of long attachments, under an assembly budget that is arithmetically satisfiable when everything is condensed. Originals are always preserved; condensation happens once per attachment in the round background (cached, context-independent), is marked as condensed in the prompt input, and F13 can diff the document against the full original. Requester-facing verification (slot confirmation with evidence) runs entirely on full text. A separate intake cap rejects oversized pasted utterances with guidance, closing the channel that bypasses attachment limits entirely. This ADR explicitly amends ADR-0011's blanket rejection of summarisation: that rejection assumed refusal preserves fidelity, but the measured alternative was no document at all.

실측(2026-07-29, 세션 49597175): 134k자 소스가 대화로 유입되자 `requirements@0.2.0`이 120초 상한(#56 이전)에서도, 300초 상한(#56 이후)에서도 미완으로 죽었다. 같은 소스를 안은 `completeness@0.2.0`은 74.8초에 성공했다. 죽는 것은 입력이 아니라 출력이다 — 판정의 출력은 슬롯 수에 비례하고, 생성의 출력은 「자료를 문서 문장으로 흡수하라」(ADR-0011 결정 6)는 규율 때문에 소스 크기에 비례한다.

## 결정

**1. 판정 호출은 항상 원문 전문을 받는다.** `clarification`·`completeness`·`promotion`의 임무는 자료 깊숙한 곳의 답을 찾아 슬롯을 채우는 것이다 — 압축에서 떨어진 사실은 영영 물어지지 않으므로 여기서의 손실은 치명적이다. 출력이 입력에 비례하지 않아 생성 봉투도 위협받지 않는다(실측 근거 위). 무상태 재조립의 입력 토큰 비용은 충실도의 값으로 받아들인다.

**2. 생성 호출은 장문 첨부의 압축본을 받는다.** `requirements`·`back-injection`이 흡수할 「확정 사항」은 이 시점에 이미 슬롯 값·근거·확인 답변으로 고정돼 있다 — 원문 전문의 한계 효용이 가장 낮은 곳이 출력 폭발이 나는 곳이다. 압축은 새 프롬프트 버전(`condensation`)의 게이트웨이 호출로, 사실·수치·표를 보존하는 축약을 만든다.

**3. 원문은 항상 보존되고, 압축본은 파생물이다.** `extracted_text`는 그대로 두고 `condensed_text`를 별도 저장한다(운영자 확정 2026-07-29). 압축은 요청 맥락에 의존하지 않으므로 첨부당 1회로 캐시된다(ADR-0011 결정 4와 같은 지위). 프롬프트 입력에는 압축본임이 표시된다.

**4. 압축은 라운드 백그라운드에서 총량 인지로 트리거된다.** 추출 완료 후 생성 투입 예정 총량이 조립 예산을 넘으면, 압축 목표보다 큰 첨부를 큰 것부터 압축한다. 전 파일이 압축돼도 예산 안에 들도록 수치를 묶는다(예산 = 세션당 첨부 상한 × 압축 목표). 예산을 넘지 않는 세션은 아무것도 압축되지 않는다 — 흔한 경우의 충실도를 지킨다.

**5. 압축 출력이 목표 길이를 넘으면 1회 재시도 후 명시 마커와 함께 절단한다.** 조용한 절단은 만들지 않는다(ADR-0011과 같은 정신).

**6. 요청자 발화에 길이 상한을 둔다.** 첨부 상한(ADR-0011)을 통째로 우회하는 경로가 붙여넣기였다. 상한 초과 발화는 사유와 함께 접수 전에 거부하고 「파일로 첨부하거나 링크로 달라」고 안내한다 — 미등록 MIME 명시 거부와 같은 철학. 노션 커넥터(ADR-0013)가 링크 경로를 실제로 열어 주는 것이 이 안내의 전제다.

**7. 수치는 결정 대기 기본값이다.** 발화 상한 10k자, 압축 목표 6k자, 생성 조립 예산 60k자(= 첨부 10개 × 6k). 근거는 관측 생성 속도(~72토큰/초)와 300초 봉투이며, PRD §12 목록에 올린다.

## ADR-0011과의 관계

ADR-0011 Consequences는 「요약 압축이나 무음 절단으로 우회하지 않는다」고 했다. 그 배제의 전제는 "거부하면 충실도가 보존된다"였는데, 실측이 제3의 결과를 보여줬다 — 장문 앞에서 선택지는 「압축된 문서」가 아니라 「문서 없음」이었다. 이 ADR은 그 조항을 다음 조건 아래 **생성 호출 한정**으로 개정한다: (a) 요청자 검증 경로(질문 생성·슬롯 판정·근거 표시)는 전부 원문 전문으로 돈다, (b) 원문은 보존되고 압축본은 표시된 파생물이다, (c) 판독(F13)이 문서와 원문을 대조할 수 있다, (d) 세션 텍스트 총량 초과의 거부 규칙 자체는 그대로다 — 압축은 예산 거부의 우회가 아니라 생성 봉투의 준수 수단이다. 확률 변환의 선례로는 이미지 서술 환원(ADR-0011 결정 3)이 있다.

## 확장 (2026-07-29, #60)

결정 2의 압축 대상을 **요청자 발화**로 넓힌다. 실증: 세션 49597175의 134k자 소스는 첨부가 아니라 대화 답변이었고, 발화 상한(결정 6)은 신규 입구만 막을 뿐 이미 저장된 발화와 정정 루프(왕복 미산입)로 누적되는 장문에는 닿지 않는다. 예산은 첨부·발화 합산 하나로 본다 — 생성 봉투가 보는 것은 총량이다. 압축본은 `utterance.condensed_text` 파생 컬럼에 캐시된다(원문 불변 트리거는 original_text만 보호). 판정 호출이 대화 전문을 받는 규율은 그대로다.

## Consequences

- `requirements`·`back-injection`이 읽는 소스의 충실도가 낮아질 수 있다. 방어선은 슬롯 단위 확인(요청자가 문서를 다시 검증)과 판독 대조이며, 압축 유래 누락이 실측되면 압축 프롬프트 버전을 올려 대응한다 — 신호는 버전 귀속으로 추적된다.
- 프롬프트 카탈로그에 `condensation`이 추가되고 회귀·배포 게이트 규율(F12)을 동일하게 따른다.
- 발화 상한은 어댑터 표면(웹·Slack)의 안내 카피를 요구한다 — 거부는 요청자 언어로, 대안(첨부·링크)과 함께.
- 세션 저장소 쓰기가 새로 생기므로(condensed_text·source_url) 상시 지시에 따라 트레이스 렌더링을 함께 확장한다.
