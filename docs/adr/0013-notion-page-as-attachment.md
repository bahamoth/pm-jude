---
status: accepted (2026-07-29)
---

# 노션 페이지는 페치해서 첨부로 다룬다

> **EN** — Requesters reference Notion pages by URL. The connector detects Notion URLs in requester utterances, fetches the page via the official API (internal integration token), converts blocks to markdown, and stores the result as an attachment (`<page title>.md`, `text/markdown`) on that utterance. From there the existing F1-Attach pipeline applies unchanged: immutable original, cached extraction, session text budget, evidence refs, extraction-failure-as-outcome. Fetching runs in the round background outside the LLM gateway envelope, with its own per-page time cap and per-session page cap. A `source_url` column on `attachment` records provenance and prevents refetching. Without `NOTION_API_KEY` the connector is off and URLs stay inert text.

요구사항 문서가 노션으로 작성되는 팀에서 요청자는 링크를 붙여넣는다. 시스템이 링크를 읽지 못하면 요청자는 본문을 통째로 대화에 붙여넣고(실측: 세션 49597175, 134k자 발화), 이는 장문 규율(ADR-0014)이 다루는 사고로 이어진다. 링크를 읽는 능력 자체가 입력 규율의 전제다.

## 결정

**1. 페치 결과는 첨부다.** 노션 페이지는 `<페이지제목>.md`(`text/markdown`) 첨부로 저장되어 요청자 발화에 붙는다. 별도 소스 타입·별도 테이블을 만들지 않는다 — 원본 불변(sha256 보관), 추출 캐시, 세션 텍스트 총량, 근거 참조(A1), 실패는 결과(P-U3)까지 ADR-0011의 규율 전부가 코드 추가 없이 적용된다. `text/markdown`은 이미 등록된 MIME이다.

**2. 커넥터는 깊은 모듈 하나다.** 인터페이스는 URL 감지와 `fetchPage(url)` 둘뿐이고, URL→ID 추출·인증·블록 재귀·페이지네이션·rate limit 대기·블록→markdown 환원은 구현 뒤에 숨는다. 노션은 첫 사례일 뿐 같은 시임에 다른 소스(위키·구글 독스)가 설 수 있다 — 어댑터가 둘이 되는 시점에 인터페이스를 승격한다.

**3. 페치는 라운드 백그라운드에서, 게이트웨이 봉투 밖에서 돈다.** 첨부 추출과 같은 자리다. LLM 호출 상한(F14·#56)과 무관하며, 대신 페이지당 시간 상한과 세션당 페이지 수 상한을 커넥터가 자체로 갖는다 — rate limit(초당 ~3요청)에 걸린 대형 페이지 크롤이 라운드를 인질로 잡지 않는다.

**4. 실패는 사유를 단 추출 실패로 남는다.** 미공유 페이지·권한·404는 요청자에게 그대로 전해진다 — "통합에 페이지를 공유해 달라"는 요청자가 해소할 수 있는 실패다. 조용히 무시된 링크는 요청자가 자료가 반영됐다고 믿게 만든다.

**5. `attachment.source_url`로 출처를 기록한다.** 판독(F13)이 페치 산출물의 출처를 알고, 라운드마다 같은 URL을 재페치하지 않는 근거가 된다.

**6. `NOTION_API_KEY` 미설정이면 커넥터는 꺼진다.** URL은 현행대로 텍스트로 남는다. 커넥터가 없던 환경의 동작이 바뀌지 않는다.

## Consequences

- 노션 데이터베이스(행 컬렉션)는 다루지 않는다 — 페이지만. `?v=` 뷰 파라미터는 무시하고 페이지 ID만 취한다. 데이터베이스 요구가 실재하면 별도 결정.
- 검색 소스(F2a)·requirements 노션 발행(출력)은 이 결정의 범위 밖이다. 방향은 확정됐고(2026-07-29 운영자) 각각 별도 티켓으로 다룬다.
- 노션 API 사실관계(인증·페이지네이션·rate limit·URL 형식)는 docs/research/의 조사 노트가 1차 소스 링크와 함께 담는다.
