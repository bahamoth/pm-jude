# PM Jude 아키텍처

> 성격: [PRD v1.4](PRD.md) §7의 논리 경계를 시각화·구체화한 문서. "어떻게"의 상세는 개발팀 재량이며, Phase 0 착수에 필요한 결정만 확정 상태로 담는다([ADR](docs/adr/) 참조). 나머지 기술 선택은 「결정 대기」로 남긴다. 브라우저 조감은 [docs/architecture.html](docs/architecture.html) — 이 문서 mermaid 블록의 렌더링이며, 블록 수정 시 `node scripts/check-arch-sync.mjs --write`로 동기화한다. 용어는 [CONTEXT.md](CONTEXT.md), 데이터 모델 상세는 [docs/data-model.md](docs/data-model.md).

## 시스템 구성도

채널 어댑터는 코어 API만 호출하고, 코어의 LLM 호출은 전부 게이트웨이를 거친다. 게이트웨이 외부는 백엔드(Phase 0 Agent SDK / Phase 1+ 직접 API)를 모른다.

```mermaid
graph TB
    subgraph EXT_IN["외부 표면"]
        SLACK_S["Slack<br/>멘션 · DM · 스레드 · 버튼"]
        WEB_S["웹<br/>채팅 · 대시보드 · 매직링크"]
    end

    subgraph ADAPTERS["채널 어댑터 (탈부착)"]
        SLACK_A["Slack 어댑터<br/>(Bolt for TypeScript)"]
        WEB_A["웹 어댑터"]
    end

    subgraph CORE["채널 비의존 코어"]
        INTAKE["인테이크 API<br/>F1"]
        SM["상태 머신<br/>+ 게이트 라우터 · SLA 스케줄러<br/>F5 · 원칙 2"]
        CLARIFY["명확화 엔진<br/>질문 생성 · 2층 판정 · 승격 판정<br/>F2b/c"]
        SEARCH["컨텍스트 검색기<br/>Linear · 문서 · 종결 세션 인덱스<br/>F2a"]
        DOCGEN["문서 생성기 + UI 분류기<br/>F3 · F4 전제"]
        MOCKSVC["목업 서비스 + 역주입기<br/>F4"]
        NOTIFY["알림 서비스<br/>언어 · 시간대 · N요청자 팬아웃<br/>F7 · F8"]
        CONNECTOR["Linear 커넥터<br/>issueCreate + provenance<br/>F6"]
        STORE[("세션 · 버전 저장소<br/>Phase 0: SQLite (ADR-0006)")]
    end

    subgraph GW["LLM 게이트웨이"]
        IFACE["complete(promptVersion, input)<br/>→ structuredOutput<br/>+ 폭주 방지 상한"]
        HARNESS["Phase 0 백엔드<br/>Claude Agent SDK (ADR-0005)"]
        DIRECT["Phase 1+ 백엔드<br/>직접 API (얇은 추상화)"]
    end

    subgraph EVAL["평가·개선 서브시스템"]
        SIGNALS["신호 수집기 F11<br/>버전 귀속 5축"]
        SCANNER["우회 스캐너<br/>provenance 스캔 (ADR-0003)"]
        EVALTOOL["평가 도구 (채택)<br/>레지스트리 · 회귀 · 배포 게이트 F12"]
        WORKBENCH["판독 워크벤치<br/>전수 리뷰 · 슬롯 매핑 현황 F13"]
    end

    subgraph EXT_OUT["외부 시스템"]
        LINEAR["Linear<br/>이슈 · 웹훅"]
        HOSTING["목업 호스팅<br/>샌드박스 usercontent 도메인"]
    end

    SLACK_S --> SLACK_A
    WEB_S --> WEB_A
    SLACK_A --> INTAKE
    WEB_A --> INTAKE
    INTAKE --> SM
    SM --> CLARIFY
    SM --> DOCGEN
    SM --> MOCKSVC
    SM --> NOTIFY
    SM --> CONNECTOR
    CLARIFY --> SEARCH
    CLARIFY --> IFACE
    DOCGEN --> IFACE
    MOCKSVC --> IFACE
    MOCKSVC --> HOSTING
    SEARCH --> LINEAR
    CONNECTOR --> LINEAR
    LINEAR -- "웹훅 (HMAC 검증)" --> NOTIFY
    SM --> STORE
    IFACE --> HARNESS
    IFACE -.-> DIRECT
    STORE --> SIGNALS
    LINEAR --> SCANNER
    SIGNALS --> WORKBENCH
    EVALTOOL -- "회귀 통과 버전만 로드" --> IFACE
```

## 상태 머신 — 요청 라이프사이클

전이의 결정 주체는 코드 상태 머신이다([ADR-0001](docs/adr/0001-fixed-orchestration.md)). 종결 상태 5종은 모두 회신 발송 없이는 진입이 완료되지 않는다(원칙 5).

```mermaid
stateDiagram-v2
    state "인테이크" as intake
    state "컨텍스트 검색 (F2a)" as search
    state "명확화 루프 (F2b/c)" as clarify
    state "승격 판정" as promotion
    state "문서 생성 + 슬롯 확인 (F3)" as docgen
    state "목업 반복 (F4 · UI 요청만)" as mockup
    state "승인 게이트 (F5)" as gate
    state "이슈 생성 (F6)" as issue
    state "추적 · 역보고 (F7)" as track
    state "중복 병합" as merge
    state "백로그" as backlog
    state "거절" as reject
    state "보류(정보 부족)" as onhold

    [*] --> intake : 접수 확인 3초 이내
    intake --> search
    search --> merge : 중복 후보 수락
    search --> clarify
    clarify --> docgen : 완결성 통과 (전 슬롯 충족·승격)
    clarify --> promotion : 왕복 상한 도달
    promotion --> docgen : 승격 가능 (오픈이슈 + 조건부 상정)
    promotion --> onhold : 승격 불가
    docgen --> mockup : UI 요청
    docgen --> gate : 비 UI 요청
    mockup --> gate : 수렴 → 역주입 → 문서 vN+1
    mockup --> gate : 반복 상한 초과 에스컬레이션
    gate --> issue : 승인 (유일한 이슈 생성 경로)
    gate --> clarify : 질문 → 요청자 되물음
    gate --> backlog : 백로그 선택 / SLA 초과 자동 전환
    gate --> reject : 거절 (통제된 사유 + 이의 경로)
    backlog --> gate : 재부상 트리거
    onhold --> clarify : 요청자 재개
    issue --> track
    merge --> track : 구독 등록 + 원문 코멘트 첨부
    track --> [*] : 완료 역보고 + CSAT
    reject --> [*]
```

코드로 강제되는 하드 제약:

- 승인 없는 Linear 이슈 생성 불가 — `gate --> issue`가 유일한 경로
- 룰 층 미통과 시 게이트 진입 불가 — 승격 경로만 예외
- 회귀 미통과 프롬프트/스키마 버전의 런타임 로드 불가(F12)
- 종결 상태 전이 시 회신 발송 없이는 세션 종료 불가
- 목업 코드의 개발팀 전달 불가 — 이미지·URL 형태만

## 대표 시퀀스

### 해피패스 — UI 요청 접수부터 역보고까지

```mermaid
sequenceDiagram
    actor R as 요청자 (Slack)
    participant A as Slack 어댑터
    participant C as 코어 (상태 머신)
    participant G as LLM 게이트웨이
    participant L as Linear
    actor D as 개발자 (수신자)

    R->>A: 봇 멘션 "대시보드 만들어줘"
    A->>C: 인테이크 (코어 세션 생성)
    C-->>R: 접수 확인 + 요청 ID (3초 이내)
    C->>G: F2a 컨텍스트 검색 (경계 툴콜 루프)
    C->>G: 표적 질문 생성
    G-->>C: 질문 3~5개 (요청자 언어)
    C-->>R: 질문 (모르겠음 선택지 포함)
    R->>C: 답변
    Note over C: 2층 판정 — 전 슬롯 충족 시 종료
    C->>G: requirements 생성
    C-->>R: 슬롯 단위 확인 (요청자 언어)
    C->>G: 목업 HTML 생성 (UI 요청 분류)
    C-->>R: 목업 URL (워터마크 상시)
    R->>C: 어노테이션 → 승인
    Note over C: 역주입 → requirements vN+1
    C->>D: 게이트 상정 (라우팅 근거 + SLA 표시)
    D->>C: 승인
    C->>L: issueCreate (원문 전사 + provenance 부착)
    L-->>C: 웹훅 (상태 변경)
    C-->>R: 역보고 (언어·시간대 인지)
```

### 승격 — 요청자 해소 불가 슬롯의 조건부 상정

```mermaid
sequenceDiagram
    actor R as 요청자
    participant C as 코어 (상태 머신)
    participant G as LLM 게이트웨이
    actor D as 개발자 (수신자)

    C-->>R: 질문 "기존 권한 모델을 따르나요?"
    R->>C: 「모르겠다 / 개발팀이 정할 문제」 1클릭
    Note over C: 슬롯 상태 → 승격<br/>담당자 지정 오픈이슈 생성
    C-->>R: 승격 사실 + 사유 회신
    C->>G: requirements 생성 (오픈이슈 필드 포함)
    C->>D: 조건부 상정 (시각적 구분 표시)
    D->>C: 승인 + 오픈이슈 담당자 확정
    Note over C: 이슈 본문에 오픈이슈 섹션 포함
```

### 중복 병합 — 새 이슈 없는 종결

```mermaid
sequenceDiagram
    actor R as 요청자
    participant C as 코어 (상태 머신)
    participant L as Linear

    C->>C: F2a 검색 중 유사 기존 요청 발견
    C-->>R: 중복 후보 제시 (요청자 언어, 근거 포함)
    alt 수락
        R->>C: 병합 수락
        C->>L: 기존 이슈에 구독자 등록 + 원문 코멘트 첨부
        C-->>R: 병합 회신 (이후 역보고 동일 수신)
    else 거부
        R->>C: 병합 거부
        Note over C: 정상 명확화 루프로 복귀
    end
```

## 데이터 모델 ERD

필드 상세와 결정 대기 항목은 [docs/data-model.md](docs/data-model.md).

```mermaid
erDiagram
    session ||--o{ session_requester : "1~N명"
    requester ||--o{ session_requester : "참여"
    session ||--o{ utterance : "원문 전사 상시 보존"
    session ||--o{ slot_state : "슬롯 3상태"
    session ||--o{ requirements_doc : "vN"
    requirements_doc ||--o{ mockup : "vN 매핑 (UI 요청만)"
    session ||--o{ gate_item : "라우팅 · SLA · 결정"
    session ||--o| linear_issue : "provenance"
    session ||--o{ signal : "F11 신호"
    session ||--o{ context_ref : "F2a 검색 기록"
    prompt_version ||--o{ session : "버전 귀속"
    slot_schema_version ||--o{ session : "버전 귀속"
    slot_schema_version ||--o{ slot_state : "슬롯 정의"

    session {
        string id PK
        string status "상태 머신 상태"
        string terminal_state "종결 5종 or null"
        string origin_channel
        bool is_ui_request
        int round_count
        string prompt_version_id FK
        string model_version
        string slot_schema_version_id FK
    }
    requester {
        string id PK
        string preferred_language
        string timezone
    }
    slot_state {
        string slot_key PK
        string state "filled/unfilled/promoted"
        bool confirmed_by_requester
        string open_issue_assignee
    }
    gate_item {
        string approver_id
        string routing_basis "수신 사유 표시"
        bool is_conditional
        datetime sla_deadline
        string decision
        string reason_tag
    }
    signal {
        string type "F11 신호 유형"
        json payload
        string prompt_version_id FK
        string slot_schema_version_id FK
    }
    linear_issue {
        string linear_issue_id
        string provenance_key "우회 집계 전제"
        string merged_into
    }
```

## 컴포넌트와 담당 기능

| 컴포넌트 | 책임 | 관련 기능 | 도입 Phase |
|---|---|---|---|
| 인테이크 API | 채널 무관 수신, 세션·프로필 생성, 즉시 확인 | F1 | 1 (PoC 축소판은 0) |
| 상태 머신 | 단계 전이 결정, 하드 제약 강제, 게이트 라우팅·SLA 스케줄링 | 원칙 2·5, F5 | 1 |
| 명확화 엔진 | 표적 질문 생성, 2층 완결성 판정, 승격 판정 | F2b/c/e | 0 (프롬프트) → 1 (전체) |
| 컨텍스트 검색기 | Linear·문서·종결 세션 인덱스, 경계 툴콜 루프, 중복 후보 | F2a | 1 |
| 문서 생성기 + UI 분류기 | requirements/tasks 생성, 슬롯 단위 확인, 목업 실행 여부 분류 | F3, F4 전제 | 0 (프롬프트) → 1 |
| 목업 서비스 + 역주입기 | 목업 생성·호스팅·버전 매핑, 어노테이션의 문서 흡수 | F4 | 2 |
| Linear 커넥터 | issueCreate, provenance 부착, 병합 처리 | F6 | 0 (수동/1개) → 1 |
| 알림 서비스 | 회신·역보고·리마인더, 언어·시간대 인지, N요청자 팬아웃 | F7, F8 | 1 |
| 세션·버전 저장소 | 세션·전사·슬롯·신호 + 버전 레지스트리 저장 | F11 전제 | 0 (SQLite) |
| LLM 게이트웨이 | 프로바이더 추상화, 폭주 상한, 회귀 통과 버전만 로드 | 원칙 4, F12, F14 | 0 |
| 신호 수집기 | 다운스트림 신호 수집·버전 귀속 5축 | F11 | 1 |
| 우회 스캐너 | provenance 없는 기능 요청 이슈 집계 | F6, §10 | 1 |
| 평가 도구 (채택) | 트레이싱·프롬프트 레지스트리·회귀 실행·배포 게이트 | F12 | 2 |
| 판독 워크벤치 | 전수 리뷰 큐, 실패 분류, 슬롯 매핑 현황, 카나리 관리 | F13 | 2 |
| 웹 어댑터 | 채팅 인테이크, 대시보드, 매직링크 뷰어 | F1, F9 | 1 (경량 뷰어) → 2 (완결 표면) |
| Slack 어댑터 | 멘션·DM·스레드 명확화, 버튼 게이트, DM 역보고 | F1 | 0 (PoC) → 1 (1차 표면) |

## 확정된 기술 결정 (Phase 0)

| 결정 | 내용 | 근거 |
|---|---|---|
| 하네스·런타임 | Claude Agent SDK + TypeScript | [ADR-0005](docs/adr/0005-phase0-agent-sdk-typescript.md) |
| 세션 저장소 | SQLite (Phase 1 Postgres 전환 전제) | [ADR-0006](docs/adr/0006-phase0-sqlite.md) |
| 오케스트레이션 | 코드 상태 머신 + 단계 내 구조화 LLM 호출 | [ADR-0001](docs/adr/0001-fixed-orchestration.md) |
| 우회 측정 | provenance 스캔 자동 집계 | [ADR-0003](docs/adr/0003-provenance-bypass-metric.md) |
| 베이스라인 | 소급 아카이브 분석 | [ADR-0004](docs/adr/0004-retrospective-baseline.md) |
| 문서 원칙 | requirements 단일 진실 원천 + 역주입 + 원문 보존 | [ADR-0002](docs/adr/0002-doc-single-source-of-truth.md) |

## 결정 대기 항목

기술 선택 중 이 문서가 열어 두는 것: 프로바이더 추상화 구현체(Vercel AI SDK / LiteLLM / Bedrock Converse — Phase 1 전환 시 확정), 목업 호스팅 상세(R2+Workers 권장선), 평가 도구(Langfuse / promptfoo — Phase 2 채택), 배포 환경. 웹 프레임워크는 Next.js + shadcn/ui로 확정됐다([ADR-0008](docs/adr/0008-frontend-nextjs-shadcn.md)). 수치·정책 미결정 항목의 전체 목록은 PRD §12.
