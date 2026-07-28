# PM Jude

비개발자 스테이크홀더의 모호한 요청을 인테이크하고, 개발자가 곧바로 구현에 착수할 수 있는 완결된 요구사항으로 정제하는 AI PM 인테이크 레이어. 이 문서는 프로젝트 전체가 따르는 정본 용어집이다 — 이슈 제목, 코드 식별자, 문서, 커밋 메시지에서 아래 용어를 그대로 쓴다.

정본 출처: PRD v1.7. 개요·원칙은 [PRD.md](PRD.md)에, 나머지 섹션은 [docs/prd/](docs/prd/)에 분할되어 있다(목차: PRD.md). 용어 충돌 시 이 문서가 우선하며, PRD 개정 시 이 문서를 함께 갱신한다. 정의만으로 부족한 용어에는 원문 위치를 병기한다.

> **EN** — PM Jude is an AI intake layer: it takes a non-developer stakeholder's vague request and refines it into requirements a developer can build from. This file is the project's canonical glossary — use these terms verbatim in issue titles, code identifiers, documents and commit messages. Each entry gives the Korean definition first and the English one after it; the two are equally binding. Where a term is contested, this file wins over the PRD, and revising the PRD means revising this file in the same change.
>
> This is a **tier T1** document, kept bilingual in a single file because a glossary is anchored by its terms rather than by its prose ([bilingual.md](docs/agents/bilingual.md)). `_Avoid_` lists the words that must not be used as synonyms, Korean first and English after the slash.

## Language

### 파이프라인 단계 · Pipeline stages

**인테이크(Intake)**:
들어온 요청을 받아 세션을 만들고 정제를 시작하는 첫 단계.
**EN** — Receive an incoming request, open a session, and begin refining it. The first stage of the pipeline.
_Avoid_: 접수 처리, 요청 등록 / triage, submission, ticketing

**컨텍스트 그라운딩(Context Grounding)**:
질문 생성 전에 기존 이슈·과거 문서·종결 세션·게이트 결정 이력을 검색해 요청을 조직 맥락 위에 놓는 것. 시스템에서 유일하게 LLM 자율 툴콜이 허용되는 지점.
**EN** — Searching existing issues, past documents, closed sessions and gate decision history *before* generating questions, so the request sits on top of what the organisation already knows. The only place in the system where the model is allowed an autonomous tool-call loop, and even there only search tools and a call ceiling.
_Avoid_: RAG, 사전 검색 / RAG, pre-search, retrieval

**명확화 루프(Clarification Loop)**:
표적 질문과 답변의 반복으로 요청의 모호성을 해소하는 대화 과정. 수행 주체는 LLM이다.
**EN** — The back-and-forth of targeted questions and answers that removes ambiguity from a request. The model runs it.
_Avoid_: 인터뷰, 질의응답 / interview, Q&A, survey

**승인 게이트(Approval Gate)**:
개발자가 승인/질문/백로그/거절 4버튼으로 결정하는 단계. 승인 시에만 Linear 이슈가 생성되며, 이 제약은 코드로 강제된다.
**EN** — The stage where a developer decides with four buttons: approve, ask, backlog, reject. A Linear issue is created on approval and never otherwise, and that constraint is enforced in code rather than requested in a prompt.
_Avoid_: 리뷰, 검수 / review, sign-off, QA

**역보고(Progress Report-back)**:
Linear 상태 변경을 요청자의 언어·시간대에 맞춰 알리는 것. 요청자가 N명이면 각자에게 팬아웃된다.
**EN** — Telling the requester about Linear status changes in their language and their timezone. With N requesters on a session it fans out to each of them.
_Avoid_: 알림(일반 의미), 노티 / notification (generic), ping

### 완결성 판정과 슬롯 · Completeness and slots

**2층 완결성 판정(Two-layer Completeness Check)**:
룰 층(필수 슬롯·형식의 기계 검사, 결정론적)과 LLM 층(남은 의미적 모호성 판정) 두 겹으로 정제 완료를 결정하는 구조. 룰 층은 LLM의 과신 통과를 막는 백스톱이다.
**EN** — Refinement is declared complete by two layers: a rule layer (deterministic machine checks on required slots and format) and an LLM layer (judging the semantic ambiguity that remains). The rule layer exists as a backstop against the model waving something through out of overconfidence.
_Avoid_: 품질 검사, 밸리데이션 / quality check, validation
원문: [§5 F2c](docs/prd/functional-requirements.md)

**슬롯(Slot)**:
요구사항이 완결되기 위해 채워져야 하는 필수 항목. 목록은 요구공학 문헌이 아니라 이 조직의 실측 재질문 유형 분류표에서 도출된다(F2e).
**EN** — A required item that must be filled before a requirement counts as complete. The list is derived from this organisation's measured re-question taxonomy, not from requirements-engineering literature (F2e).
_Avoid_: 필드, 항목 / field, attribute
원문: [§5 F2e](docs/prd/functional-requirements.md)

**슬롯 3상태(Slot Tri-state)**:
각 슬롯이 갖는 상태 — `충족` / `미충족` / `승격`. 통과 조건은 "모든 필수 슬롯이 충족 또는 승격".
**EN** — Every slot is `filled`, `unfilled` or `promoted`. The pass condition is that every required slot is filled or promoted.

**승격(Promotion)**:
요청자가 원리적으로 답할 수 없는 슬롯을 담당자 지정 오픈이슈로 올리는 것. 요청은 멈추지 않고 조건부로 게이트에 상정된다.
**EN** — Raising a slot the requester cannot answer in principle into an open issue with an assignee. The request does not stall; it goes to the gate conditionally.
_Avoid_: 에스컬레이션, 이관 / escalation, hand-off
원문: [§5 F2c](docs/prd/functional-requirements.md) — 판정 기준은 [§12-4 결정 대기](docs/prd/pending-decisions.md)

**오픈이슈(Open Issue)**:
승격된 슬롯과 담당자가 requirements 문서에 실리는 필드. Linear 이슈 본문에도 섹션으로 들어간다.
**EN** — The field in the requirements document carrying promoted slots and their assignees. It also appears as a section in the Linear issue body.

**조건부 상정(Conditional Submission)**:
미해결 오픈이슈를 포함한 채 게이트에 올라간 상태. 게이트 UI에서 시각적으로 구분된다.
**EN** — Reaching the gate with unresolved open issues attached. The gate UI marks these apart from clean submissions.

**금칙 모호어(Banned Vague Terms)**:
수용기준에 남으면 안 되는 사전 정의 모호 표현("적당히", "빨리", "개선" 등). 룰 층 형식 검사의 일부.
**EN** — A predefined list of vague expressions that must not survive into acceptance criteria ("appropriately", "fast", "improve"). Part of the rule layer's format check, and carried in both languages because the team writes in both.

### 사람 · People

**요청자(Requester)**:
요청을 넣는 비개발자 스테이크홀더. 한 세션에 1~N명이며, 각자 선호 언어·시간대를 갖는다.
**EN** — The non-developer stakeholder who files the request. One to N per session, each with their own preferred language and timezone.
_Avoid_: 사용자, 고객, 유저 / user, customer

**대리 요청자(Proxy Requester)**:
원 요청자(고객·팀원)의 요구를 대신 전달하는 사람. 세션은 요청자 ≠ 실사용자를 표현할 수 있어야 한다.
**EN** — Someone relaying a need on behalf of the person who actually has it — a CS lead carrying a customer's request, a team lead carrying a report's. The session schema must be able to express requester ≠ end user.

**실사용자(End User)**:
결과물을 실제로 쓰는 사람. 대리 요청 상황에서 요청자와 분리된다.
**EN** — The person who will actually use what gets built. Distinct from the requester whenever the request is proxied.

**수신자(Gate Approver)**:
게이트 결정을 내리는 개발자. 라우팅 규칙(영역 담당 → 팀 기본 승인자 → 대체자)으로 정해진다.
**EN** — The developer who makes the gate decision, selected by routing rules: area owner, then team default approver, then the fallback.
_Avoid_: 리뷰어, 담당자(모호) / reviewer, owner (ambiguous)

### 인격 · The character

**Jude**:
요청자에게 보이는 인테이크 에이전트의 인격 이름. 제품 전체를 가리키는 `PM Jude`(저장소·패키지 이름)와 구분한다 — 제품 안에서 요청자와 대화하는 주체가 Jude다.
**EN** — The name of the character a requester talks to. Distinct from `PM Jude`, which names the product, the repository and the package. Jude is who speaks inside the product. Third person is he/him.
_Avoid_: 봇, 어시스턴트, 에이전트(모호) / bot, assistant, agent (ambiguous)
원문: [docs/persona/jude.md](docs/persona/jude.md)

**페르소나(Persona)**:
Jude의 정체·목소리·조형을 규정한 정본. 프롬프트 본문과 UI 카피는 이것의 구현이며, 어긋나면 페르소나 문서가 우선한다.
**EN** — The canonical specification of Jude's identity, voice and form. Prompt bodies and UI copy implement it; where they disagree, the persona document wins.
_Avoid_: 캐릭터(조형만 가리킨다), 톤앤매너 / character (form only), tone of voice

**목소리 규칙(Voice Rules)**:
페르소나 중 「어떻게 말하는가」와 「어느 표면에 적용되는가」를 규정한 부분. 적용 범위는 요청자 대면 표면으로 한정된다 — requirements 문서는 중립을 유지한다.
**EN** — The part of the persona covering how Jude speaks and which surfaces that voice reaches. Scope is limited to requester-facing surfaces; the requirements document stays neutral.
_Avoid_: 카피 가이드, 문체 가이드 / copy guide, style guide
원문: [ADR-0010](docs/adr/0010-persona-scope.md)

### 종결과 상태 · Terminal states

**종결 상태(Terminal State)**:
`이슈 생성` / `중복 병합` / `백로그` / `거절` / `보류(정보 부족)` 5종. 모든 종결 상태는 사유를 담은 회신을 트리거하며, 회신 발송 없이는 세션 종료가 불가하다(원칙 5).
**EN** — Five of them: issue created, duplicate merge, backlog, rejected, on-hold for insufficient info. Every one triggers a reply carrying a reason, and a session cannot close until that reply has gone out (principle 5).
원문: [§5 F8](docs/prd/functional-requirements.md)

**중복 병합(Duplicate Merge)**:
같은 요청이 이미 있을 때 새 이슈를 만들지 않고 기존 이슈에 요청자를 구독자로 등록하는 종결. 요청 원문·맥락은 기존 이슈에 코멘트로 첨부된다.
**EN** — When the request already exists, no new issue is created; the requester is subscribed to the existing one and their original wording and context are attached as a comment.
_Avoid_: 중복 처리, 병합(git 의미) / dedupe, merge (in the git sense)

**보류(정보 부족)(On-hold — Insufficient Info)**:
왕복 상한 도달 후 승격조차 불가한 요청의 종결 상태. 요청자가 언제든 재개할 수 있다.
**EN** — The terminal state for a request that hit the round-trip ceiling and could not even be promoted. The requester can resume it at any time.
_Avoid_: 펜딩, 홀드 / pending, blocked

**재부상(Resurfacing)**:
백로그 항목이 트리거(유사 요청 누적 N회, 정기 리뷰 도래)로 게이트에 재상정되는 것.
**EN** — A backlog item returning to the gate on a trigger: N similar requests accumulated, or a scheduled review coming due.

**SLA 자동 백로그(SLA Auto-backlog)**:
게이트 항목이 SLA를 초과하면 리마인더·대체자 통보를 거쳐 자동으로 백로그 전환되는 처리. 게이트가 무기한 대기하는 경로는 존재하지 않는다.
**EN** — A gate item past its SLA goes through reminders and a fallback-approver notice, then converts to backlog automatically. There is no path where the gate waits indefinitely.
원문: [§5 F5](docs/prd/functional-requirements.md)

### 산출물과 원칙 · Artefacts and principles

**requirements 문서**:
구현의 유일한 근거가 되는 요구사항 문서. 구성: 문제 / 사용자 / 스코프 / 유저스토리·수용기준 / 데이터 소스 / 오픈이슈. "어떻게"(아키텍처·스택·코드)는 비운다.
**EN** — The requirements document, and the only basis for implementation. Sections: problem, users, scope, user stories with acceptance criteria, data sources, open issues. The "how" — architecture, stack, code — is deliberately absent.
_Avoid_: 스펙(구현 명세 의미로), PRD(이 저장소에선 제품 전체 문서를 가리킴) / spec (as implementation spec), PRD (that names the product-wide document here)

**문서 단일 진실 원천(Single Source of Truth)**:
requirements 문서만이 구현 근거이며 대화 전사·목업·번역본·채널 스레드는 그것을 대체하지 않는다는 원칙(원칙 7).
**EN** — The principle that only the requirements document grounds implementation, and that transcripts, mockups, translations and channel threads never substitute for it (principle 7).

**역주입(Back-injection)**:
목업 어노테이션에서 확정된 사항을 승인 시 requirements vN+1의 문장으로 흡수하는 것. 흡수 후 목업은 폐기 가능해야 한다.
**EN** — Absorbing anything settled in mockup annotations into requirements vN+1 as prose at approval time. Once absorbed, the mockup must be disposable.
_Avoid_: 반영, 동기화 / sync, apply
원문: [§5 F4](docs/prd/functional-requirements.md)

**원문 전사(Original Transcript)**:
요청자 언어 그대로의 대화 기록. 옵션이 아니라 상시 보존 대상이며 Linear 이슈에 첨부된다.
**EN** — The conversation as it happened, in the requester's own language. Retained always, not optionally, and attached to the Linear issue.

**첨부 자료(Attachment)**:
요청자가 발화에 붙여 올린 파일. 명확화 입력이며 추출 텍스트가 슬롯을 채우는 근거가 된다. 원본은 불변 보존되고, 문서에서의 지위는 원문 전사와 같다 — 확정된 것은 문서 문장으로 흡수되고 파일 자체는 참고용으로 동봉된다.
**EN** — A file the requester attaches to an utterance. It is clarification input: its extracted text can fill a slot. The uploaded original is preserved immutably, and in the requirements document it holds the same position as the original transcript — whatever it settles becomes prose in the document, and the file travels as reference material rather than as the basis for implementation.
_Avoid_: 파일, 업로드, 자료(단독) / file, upload, document (bare)
원문: [ADR-0011](docs/adr/0011-attachment-as-clarification-input.md)

**슬롯 단위 확인(Slot-level Confirmation)**:
요청자 확인을 산문 번역본이 아니라 구조화 슬롯 값 단위로, 요청자 언어로 수행하는 것. 번역 무결성 장치.
**EN** — Confirming with the requester on structured slot values in their own language, rather than on a prose translation. A guard on translation integrity: translation is a lossy transform performed by a probabilistic component, and neither side can verify it.

**목업(Mockup)**:
UI 요청에 한해 생성되는 요구 확인용 중간충실도 인터랙티브 HTML 화면. 레이아웃 반복 단계는 그레이스케일이고, 수렴 후 디자인 시스템 선정 단계에서만 테마 변형이 입혀진다(v1.7). 구현 결과물·코드 기준이 아니며, 코드 형태로는 개발팀에 노출되지 않는다.
**EN** — A medium-fidelity interactive HTML screen, generated for UI requests only, to confirm what was asked for. Grayscale during layout iteration; theme variants appear only in the design-system selection stage after convergence (v1.7). Not a deliverable and not an implementation reference; it is never handed to the development team as code.
_Avoid_: 프로토타입, 시안, 와이어프레임 / prototype, comp, wireframe

**디자인 시스템 선정(Design System Selection)**:
레이아웃이 수렴한 목업에 테마 레지스트리의 후보를 테마 변형으로 입혀 제시하고, 요청자가 1택하거나 개발팀에 위임하는 목업 반복의 마지막 단계. 선정 없이 승인은 없다.
**EN** — The final stage of the mockup loop: candidates from the theme registry are shown as theme variants of the converged mockup, and the requester picks one or delegates to the team. No approval without a selection (or delegation).
_Avoid_: 테마 고르기, 스킨 선택 / theming, skinning
원문: [§5 F4](docs/prd/functional-requirements.md)

**테마 레지스트리(Theme Registry)**:
디자인 시스템 선정 후보의 출처 — 내장 프리셋과 외부 등록 테마(디자인 토큰 JSON·CSS 파일)를 같은 인터페이스로 나열한다. 같은 id의 외부 테마가 내장을 덮으므로, 조직 표준은 코드 수정 없이 파일 등록으로 흡수된다.
**EN** — Where selection candidates come from: built-in presets and externally registered themes (design-token JSON, CSS files) behind one interface. An external theme with the same id overrides a preset, so an organisation standard is absorbed by file registration, never a code change.
_Avoid_: 테마 목록, 스타일 카탈로그 / theme list, style catalogue

**확정된 시각 방향(Visual Direction)**:
디자인 시스템 선정의 결과가 역주입 시 requirements 구조체에 기록되는 필드. 구현 스택 강제가 아니라 요청자 확인을 거친 시각 언어의 기록이며, 구현 수단 선택은 개발팀 재량으로 남는다 — "어떻게 비움" 원칙과의 경계가 여기다.
**EN** — The field the selection result becomes in the requirements structure at back-injection time. It records the visual language the requester confirmed — not a stack mandate; the implementation choice stays with the team. This is the boundary with the "no how in the document" principle.
_Avoid_: 디자인 스펙, 스타일 가이드(문서 의미) / design spec, style guide (as a document)

### 아키텍처 · Architecture

**고정 오케스트레이션(Predefined Control Flow)**:
단계 전이를 코드로 작성된 상태 머신이 결정하고, LLM은 단계 안의 구조화 호출로만 존재하는 방식. 자율 에이전트 루프의 반대 개념.
**EN** — Stage transitions are decided by a hand-written state machine; the model exists only as structured calls inside a stage. The opposite of an autonomous agent loop.
_Avoid_: 워크플로우 엔진, 파이프라인(모호) / workflow engine, pipeline (ambiguous)
원문: [PRD.md §3 원칙 2](PRD.md) — 상태 머신 전 경로는 [§7](docs/prd/system.md)

**결정론적(Deterministic)**:
같은 입력이면 항상 같은 출력. 이 저장소에서는 룰 기반 구조 검사와 게이트 강제 코드에만 쓴다. LLM 호출에는 쓰지 않는다.
**EN** — Same input, same output, every time. In this repository the word is reserved for rule-based structural checks and gate-enforcement code. It is never used of an LLM call. The system as a whole is best described as predefined orchestration wrapped around probabilistic components.

**세션(Session)**:
하나의 요청이 인테이크부터 종결까지 거치는 상태 단위. 채널·시간대를 넘어 연속되고, 프롬프트/모델/임계치/슬롯 스키마 버전에 귀속된다.
**EN** — The unit of state one request occupies from intake to terminal state. Continuous across channels and timezones, and attributed to prompt, model, threshold and slot-schema versions.
_Avoid_: 대화, 스레드, 티켓 / conversation, thread, ticket

**세션 귀속(Provenance)**:
생성된 이슈에 세션 ID를 기계 판독 가능한 형태로 남기는 것. 우회율 자동 집계의 전제.
**EN** — Leaving the session id on every created issue in a machine-readable form. The precondition for counting bypass automatically.
_Avoid_: 추적, 태깅 / tracking, tagging
원문: [§5 F6](docs/prd/functional-requirements.md)

**채널 어댑터(Channel Adapter)**:
코어를 특정 표면(웹/Slack, 향후 Teams/이메일)에 연결하는 탈부착 모듈. 모든 어댑터는 동일한 코어 API만 호출한다.
**EN** — A detachable module connecting the core to one surface: web, Slack, later Teams or email. Every adapter calls the same core API and nothing else.

**추출(Extraction)**:
첨부 자료를 명확화 입력으로 쓸 수 있는 텍스트로 환원하는 것. MIME별 추출기가 담당하며 이미지는 등록된 추출 프롬프트로 서술 텍스트가 된다. 결과는 추출기 버전을 단 재생성 가능한 캐시이지 원본의 대체물이 아니다.
**EN** — Reducing an attachment to text that can serve as clarification input. A per-MIME extractor does the work, and images go through a registered extraction prompt that yields descriptive text. The result is a regenerable cache stamped with its extractor version, never a replacement for the original.
_Avoid_: 파싱, 변환, OCR(일반 의미) / parsing, conversion, OCR (generic)
원문: [ADR-0011](docs/adr/0011-attachment-as-clarification-input.md)

**LLM 게이트웨이(LLM Gateway)**:
얇은 프로바이더 추상화 + 폭주 방지 상한. 표준 인터페이스는 `complete(promptVersion, input) → structuredOutput`. 게이트웨이 외부는 백엔드 종류를 모른다.
**EN** — A thin provider abstraction plus runaway-cost ceilings. The interface is `complete(promptVersion, input) → structuredOutput`, and nothing outside the gateway knows which backend is behind it.

**헤드리스 하네스(Headless Harness)**:
Claude Code를 UI 없이 프로그램적으로 실행하는 Phase 0 한정 게이트웨이 백엔드. Claude Agent SDK로 구현한다(ADR-0005).
**EN** — Running Claude Code programmatically without a UI, as the gateway backend for Phase 0 only. Implemented with the Claude Agent SDK (ADR-0005).
원문: [§5 F14](docs/prd/functional-requirements.md)

### 품질과 개선 · Quality and improvement

**다운스트림 신호(Downstream Signal)**:
정제 품질의 궁극 판정자 — 게이트 결정·사유 태그, 재질문, reopen, 스펙 변경, 목업 반복, 후행 피드백, CSAT. 내부 점수가 아니다.
**EN** — The final arbiter of refinement quality: gate decisions and their reason tags, re-questions, reopens, spec edits, mockup iterations, later feedback, CSAT. Explicitly not an internal score.
원문: [§5 F11 신호 표](docs/prd/functional-requirements.md)

**재질문(Re-question)**:
승인 통과 후 개발자가 요구사항 불충분으로 다시 묻는 행위. 유형 분류가 슬롯 목록 갱신(F2e)의 입력이다.
**EN** — A developer asking again after approval because the requirements were not sufficient. Classifying these by type is what feeds slot-list revision (F2e).
_Avoid_: 추가 질문, 문의 / follow-up, enquiry

**스키마 결손(Schema Gap)**:
반복되는 재질문 유형에 대응 슬롯이 없는 상태. 프롬프트 결함과 구분되는 별도 개선 후보 — 이 구분이 개선 루프의 핵심이다.
**EN** — A recurring re-question type with no slot to catch it. A separate class of improvement candidate from a prompt defect, and telling the two apart is the point of the improvement loop.

**버전 귀속(Version Attribution)**:
모든 신호를 `세션 ID × 프롬프트 버전 × 모델 버전 × 임계치 버전 × 슬롯 스키마 버전`에 묶는 것. 계측 없는 기능은 만들지 않는다.
**EN** — Binding every signal to `session id × prompt version × model version × threshold version × slot schema version`. Features without instrumentation do not get built.

**골든셋(Golden Set)**:
회귀 평가용으로 큐레이션된 익명화 실제 세션 모음. 평가용/개선용 분리, 분기 갱신, 자체 버전 관리.
**EN** — A curated set of anonymised real sessions for regression evaluation. Split into evaluation and improvement halves, refreshed quarterly, versioned in its own right.

**판독 큐(Review Queue)**:
운영자가 전 세션을 리뷰하는 큐. 저볼륨에서 1차 평가 수단이며, 판독 기록은 미래 LLM-judge 보정용 라벨 자산이 된다.
**EN** — The queue where the operator reviews every session. At low volume this is the primary evaluation instrument, and the review records become the labelled data that would later calibrate an LLM judge.

**배포 게이트(Deployment Gate)**:
`회귀 통과` 플래그 없는 프롬프트/스키마 버전의 런타임 로드를 코드 수준에서 차단하는 통제. 프로세스가 아니라 코드다.
**EN** — Code-level refusal to load a prompt or schema version that lacks the `regression passed` flag. A control in code, not a step in a process.

**카나리 배포(Canary Release)**:
새 버전을 신규 세션 일부에만 적용하고 재측정 후 승격/롤백하는 배포 방식. 볼륨과 무관하게 유지되는 안전장치.
**EN** — Applying a new version to a fraction of new sessions, re-measuring, then promoting or rolling back. Kept regardless of volume.

**우회율(Bypass Rate)**:
provenance 없는 기능 요청 이슈 수 / 전체 기능 요청 이슈 수. 롤아웃 정책 발효 후에는 채택이 아니라 컴플라이언스 지표로 읽는다.
**EN** — Feature-request issues without provenance, over all feature-request issues. Once the rollout policy is in force this reads as a compliance metric, not an adoption one.
원문: [§10](docs/prd/metrics-and-risks.md)

**선행 지표(Leading Indicator)**:
문제 확정 전에 먼저 움직이는 채택 신호 — 세션 중도 이탈율, 재사용률, 요청자 소요 시간. 판단은 선행 지표로 한다.
**EN** — Adoption signals that move before the problem is confirmed: session drop-off, reuse rate, requester time spent. Judgement is made on these, not on the lagging ones.

**베이스라인(Baseline)**:
지표 판정의 기준 수치. 도입 전 측정은 v1.6에서 폐기(ADR-0012) — 초기 운영 구간의 자기 세션 데이터가 기준선이 되고, 개선은 버전 간 추이(vN 대비 vN+1)로 판정한다.
**EN** — The reference figure metrics are judged against. Pre-adoption measurement was abandoned in v1.6 (ADR-0012) — the system's own early sessions become the baseline, and improvement is judged version-over-version.

**소급 아카이브 분석(Retrospective Archive Analysis)**:
최근 6~12개월 Linear 아카이브에서 재질문·reopen·스펙 편집을 추출해 베이스라인과 재질문 유형 분류표를 산출하려던 Phase 0 작업(ADR-0004). ADR-0012로 폐기 — 이 조직은 Linear 이슈를 개발자가 작성해 요청자↔개발자 명확화 대화가 아카이브에 없다. 도구(`pnpm retro`)는 코드로 잔존.
**EN** — The Phase 0 exercise of mining 6–12 months of Linear archive for re-questions, reopens and spec edits (ADR-0004). Abandoned by ADR-0012 — issues here are authored by developers, so the requester–developer dialogue never reached the archive. The tooling (`pnpm retro`) remains as code.
원문: [§9](docs/prd/scope-and-milestones.md)
