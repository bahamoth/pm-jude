---
status: accepted (2026-08-02)
---

# 문서가 다이어그램을 규범으로 품는다 — 「흡수=문장화」 등식 폐기

> **EN** — Phase 0 dogfooding surfaced a use case the pipeline degrades: requesters arrive with partially-developed artifacts (diagrams, documents, visual material), and the dense structural information in those artifacts — flows, hierarchies, screen topology — collapses when everything is absorbed as prose. The loss looked like a Principle-7 consequence, but Principle 7 only forbids *other surfaces* from substituting for the document; nothing requires the document itself to be text-only. The real cause is the implicit equation "absorb = write sentences" (F3 v1.5). Decision: `requirements` becomes a mixed artifact — prose plus **normative regenerated diagrams** (text-notation formats, mermaid first), confirmed with the requester diagram-by-diagram under the same discipline as slot-level confirmation. Original attachments stay reference-only; the "document alone suffices to build" goal survives because the diagrams live *inside* the document. Grilling session 2026-08-02, board #68; evidence is n=1 dogfooding, to be validated by live-usage signals.

Phase 0 도그푸딩에서 파이프라인이 열화시키는 유즈케이스가 드러났다. 요청자는 빈손으로만 오지 않는다 — 다이어그램·문서·시각자료처럼 **어느 정도 진행된 산출물을 지참한 정제 요청**이 있고, 이때 원본이 담고 있던 고밀도 구조 정보(흐름·계층·화면 위상)가 대거 소실된다. 경로를 추적하면 손실 지점은 두 규정의 합성이다:

- F1-Attach(ADR-0011)는 이미지·다이어그램을 추출 프롬프트로 **서술 텍스트**로 만든다.
- F3 v1.5는 첨부 유래 확정 사항을 requirements의 **문장으로 흡수**하고, 「첨부를 지워도 문서만으로 구현 가능한 상태」를 목표로 둔다.

원칙 7(문서 단일 진실 원천)이 원인처럼 보이지만 아니다. 원칙 7이 금지하는 것은 **다른 표면(전사·목업·번역본·스레드)이 문서를 대체하는 것**이지, 문서 매체의 텍스트 한정이 아니다. 손실의 원인은 「흡수=문장화」라는 암묵 등식이다. 플로우 다이어그램 하나를 문장 여러 개로 풀면 관계 정보는 남아도 **한눈에 성립하던 위상이 사라지고**, 개발자는 원본을 다시 찾게 된다 — 참고용 첨부가 사실상의 구현 근거가 되는 순간 원칙 7이 막으려던 바로 그 상태가 재현된다.

## 결정

**1. `requirements`는 텍스트 + 규범 다이어그램의 혼합 산출물이다.** 시각 구조가 정보의 본질인 확정 사항(프로세스 흐름, 상태 전이, 데이터·화면 계층, 화면 구성)은 문장이 아니라 **재생성 다이어그램**으로 흡수한다. 다이어그램은 문서의 일부이므로 원칙 7은 무손상이고, 「첨부를 지워도 문서만으로 구현 가능」 목표도 그대로 선다 — 규범이 문서 안으로 들어왔을 뿐이다.

**2. 형식은 텍스트 표기 다이어그램, mermaid 우선.** 버전 diff가 가능하고, 저장소 문서 뷰어와 트레이스 뷰어가 이미 렌더링한다. 이미지 재생성(래스터)은 규범 지위를 갖지 않는다.

**3. 다이어그램 단위 확인 — 슬롯 단위 확인과 같은 규율.** 재생성 다이어그램은 추출과 해석을 거친 산물이라 **요청자가 그린 적 없는 그림**이다. 슬롯 출처 규정(F2c v1.5)과 같은 이유로, 재생성본을 요청자 언어로 원본과 대조 확인하고 출처(어느 첨부에서 왔는지)를 표시한다. 확인 없는 재생성 다이어그램은 규범이 되지 않는다.

**4. 원본 첨부의 지위는 불변.** 「참고용 — 구현 근거는 문서」 표기와 동봉 규정(F3 v1.5)은 그대로다. 이 ADR은 원본을 승격시키는 결정이 아니라 **문서를 원본만큼 유능하게 만드는** 결정이다.

## 채택하지 않은 대안

- **원본 첨부의 규범 승격** — 손실은 제로가 되지만 문서 자족성이 깨지고, 원본 품질이 들쑥날쑥할 때 규범이 오염된다. 정제하지 않은 입력이 규범이 되는 것은 이 제품의 존재 이유와 모순.
- **현상 유지(문장화 흡수 + 명확화 질문으로 회수)** — 질문으로 회수되는 것은 요청자가 언어화할 수 있는 부분뿐이다. 시각 구조는 요청자도 말로 다시 풀지 못하는 정보라서 손실이 관찰됐다.

## Consequences

- F3 산출물 정의·수용기준 개정(v2.0). 구조화 호출 ③(requirements/tasks 생성)의 출력 스키마에 다이어그램 섹션이 추가된다 — 상태 머신 전이는 변경 없음.
- 다이어그램이 있는 세션은 요청자 확인 왕복이 늘어난다. 이 비용은 손실된 정보를 개발 단계에서 재질문으로 지불하는 것보다 싸다는 가설이며, F11 신호(다이어그램 정정률·개발자 재질문)로 검증한다.
- 판독 큐(F13) 점검 항목에 「원본 대비 재생성 다이어그램의 정보 누락」이 추가된다.
- 근거는 n=1 도그푸딩 관찰이다. 실사용 신호가 이 방향을 반증하면(다이어그램 확인이 이탈을 유발하거나 정정률이 낮아 확인이 형식화되면) 확인 단계의 규율을 재검토한다.
