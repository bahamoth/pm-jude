---
status: accepted (2026-07-28)
---

# 첨부 자료는 명확화 입력이며, 추출 텍스트로 환원해 다룬다

> **EN** — Requesters can attach files at intake and at every later turn. An attachment is not a side channel: its extracted text feeds question generation and the completeness check, and it can fill a slot. Everything reaching the model goes through one text path — images become descriptive text via a registered extraction prompt — so the gateway contract `complete(promptVersion, input) → structuredOutput` and the F14 exit criterion survive untouched. The uploaded original is immutable; the extracted text is a regenerable cache carrying its extractor version. Version attribution stays at five axes. In the requirements document an attachment holds the same position as the original transcript: whatever it settles is absorbed into the document as prose, and the file itself travels as reference material, never as the basis for implementation.

인테이크는 텍스트만 받는다. 요청자가 이미 정리해 둔 기획서·표·스크린샷을 넣을 자리가 없어, 그 내용은 요청자가 손으로 옮겨 적거나 명확화 왕복으로 되묻는 방식으로만 시스템에 들어온다. 첨부를 허용하되 그것이 파이프라인 어디에 서는지를 이 문서가 정한다.

## 결정

**1. 첨부는 명확화 입력이다.** 추출한 텍스트가 질문 생성(F2b)과 2층 완결성 판정(F2c)의 입력으로 들어가고, 슬롯을 `충족`으로 만드는 근거가 될 수 있다. 첨부를 개발자만 읽는 참조물로 두는 선택지는 배제한다 — 문서에 없는 확정 사항이 첨부에만 사는 구조가 되어, F4 역주입이 막으려던 누수를 다른 경로로 다시 만든다.

**2. 첨부는 요청자 발화에 붙는다.** 인테이크·명확화 답변·보류 재개 입력·슬롯 정정 어디서든 붙일 수 있고, 규칙은 이 한 줄뿐이다. 지점별 허용 목록을 두면 화면과 코드가 곳곳에서 갈리는 데 비해 얻는 것이 없다.

**3. 파이프라인에 닿는 경로는 텍스트 하나다.** 이미지는 레지스트리에 등록된 추출 프롬프트로 서술 텍스트가 되고, 파이프라인 호출(질문 생성·완결성 판정·승격 판정·문서 생성)에는 그 텍스트만 실린다. 근거는 두 가지다. 게이트웨이 표준 인터페이스가 그대로 유지되어 F14 Exit 기준(직접 API 교체 시 코드 변경이 게이트웨이 구현체 1곳)이 살아 있고, 대화 맥락을 매 호출마다 저장소에서 재조립하는 무상태 구조(F14 운영 규약)에서 원본 재전송이 라운드 수만큼 곱해지지 않는다.

이미지가 모델에 그대로 닿는 지점은 **추출 호출 하나뿐**이며, 그곳이 이미지를 텍스트로 바꾸는 유일한 곳이다. 이 예외 없이는 이미지 지원 자체가 성립하지 않는다. 예외는 게이트웨이 안에 갇힌다 — 호출자는 「이 첨부를 추출해 달라」고만 말하고 원본이 어떤 형태로 백엔드에 전달되는지 모른다. 세션당 한 번만 일어나는 호출이므로 라운드 곱셈도 없다.

**4. 원본은 불변, 추출 텍스트는 파생이다.** 업로드된 파일은 sha256 주소로 보관하고 삭제·치환 경로를 만들지 않는다(원칙 7의 확장 — 요청자가 준 것은 보존한다). 추출 텍스트는 추출기 버전을 달고 저장되는 캐시이며 재추출로 갱신된다. 추출 결과를 `utterance.original_text`에 흡수하는 선택지는 배제한다 — 불변 트리거(마이그레이션 0001)가 재추출을 영구 차단하고, 기계 산출물이 「요청자가 한 말」의 기록에 섞인다.

**5. 버전 귀속은 5축을 유지한다.** 추출기 버전은 `attachment` 행과 관련 신호의 payload에 남기고, `signal`의 축으로 올리지 않는다. 5축은 모든 신호가 반드시 갖는 NOT NULL 불변식인데(F11), 첨부는 일부 세션에만 존재하므로 축이 되는 순간 nullable이나 센티널이 필요해진다.

**6. 문서에서의 지위는 원문 전사와 같다.** 첨부에서 확정된 것은 `requirements` 문서의 문장으로 흡수되고, 파일 자체는 「참고용, 구현 근거는 문서」 표기와 함께 동봉된다. 첨부를 지워도 문서만으로 구현 가능한 상태가 목표이며, 이는 F4가 목업에 요구하는 규율과 같다(ADR-0002, 원칙 7).

## Consequences

**상태 머신은 변하지 않는다.** 새 상태도 새 전이도 없다. 추출은 상태가 아니라 라운드 백그라운드 작업의 첫 단계이므로 세션당 1개 동시성 규칙·SSE 수명 규칙·미완 라운드 재시도 계약(G-10)이 그대로 적용된다. 첨부가 발화에 붙는다는 결정 덕분에 라운드 정합(`roundId`)과 왕복 상한 산입 규칙도 손대지 않는다 — 자료를 더 붙이는 것은 라운드를 소비하지 않는다.

**슬롯 근거의 세밀도가 한 단계 올라간다.** `slot_state`에 첨부 참조가 더해지고, 슬롯 확인 카드는 요청자가 말한 적 없는 값에 출처를 표시한다. 추출과 해석을 거친 값일수록 어디서 왔는지 보여야 「맞아요 / 아니에요」가 판단 가능한 물음이 된다. F13 판독은 이 참조로 추출 결함과 프롬프트 결함을 가른다 — 스키마 결손과 프롬프트 결함을 가르는 것과 같은 종류의 구분이 하나 늘어난다.

**추출 실패는 세션을 멈추지 않는다.** 암호화 PDF·스캔본·손상 파일은 사유와 함께 실패로 분류되고, 요청자에게 무엇을 읽지 못했는지 알린 뒤 명확화는 계속된다. 원리적으로 추출 불가한 자료가 요청을 영구히 막는 경로를 만들지 않는다(P-U3).

**프롬프트 3종의 버전이 오른다** — `clarification`·`completeness`·`requirements`. 첨부를 인식하지 못하는 프롬프트는 첨부를 요청자 발화로 오귀속하므로 결정 6의 출처 추적이 성립하지 않는다. `promotion`은 컨텍스트만 늘어나므로 본문이 바뀌지 않는다. 이번 변경의 다운스트림 신호는 세 축에서 함께 해석해야 하며, 이는 페르소나 도입(ADR-0010)이 한 축만 건드린 것과 대비된다.

**상한 수치 세 건이 결정 대기로 열린다** — 파일당 크기, 세션당 추출 텍스트 총량, 세션당 첨부 개수. 총량 초과는 업로드 시점에 거부하며, 요약 압축이나 무음 절단으로 우회하지 않는다. 요약은 추출 위에 확률적 변환을 하나 더 얹어 요청자도 개발자도 검증할 수 없는 구간을 만들고, 절단은 자료의 뒷부분에 답이 있는데도 「정보 부족」 보류로 끝나는 경로를 만든다.

**세션 보존 기간(O-1) 결정이 시급해진다.** 첨부에는 원문 전사보다 민감한 자료가 들어올 수 있고, 원본을 불변으로 보관하기로 한 이상 보존 기간이 곧 노출 기간이다.

**목업 호스팅 규약과의 정렬은 F4 도입 시점으로 미룬다.** Phase 0의 파일 서빙은 `Content-Disposition: attachment`와 `nosniff` 강제, 세션 스코프 접근으로 하고, 허용 타입에서 SVG를 제외한다. 별도 usercontent 도메인과 만료 서명 URL은 목업과 함께 도입한다 — 로컬 단일 프로세스 PoC에 도메인 분리 인프라를 먼저 세우는 것은 순서가 뒤집힌 일이다.
