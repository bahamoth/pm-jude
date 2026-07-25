# 데이터 모델 초안 — 세션·슬롯·신호·버전 귀속

> 성격: Phase 0~1 코어의 논리 데이터 모델 초안. 저장소는 Phase 0 SQLite → Phase 1 Postgres([ADR-0006](adr/0006-phase0-sqlite.md)). 물리 스키마(인덱스·파티셔닝)는 구현 재량이며, 필드 수준의 미확정 항목은 「결정 대기」로 표기한다. ERD는 [ARCHITECTURE.md](../ARCHITECTURE.md#데이터-모델-erd)에 있다.

## 설계 원칙 4가지

1. **버전 귀속 5축** — 모든 신호는 `세션 ID × 프롬프트 버전 × 모델 버전 × 임계치 버전 × 슬롯 스키마 버전`에 묶인다(F11). 세션 생성 시점의 버전을 세션에 고정 기록하고, 신호에는 발생 시점의 버전을 중복 기록한다(세션 중 카나리 전환 대비).
2. **다중 요청자 최소 모델** — 세션:요청자 = N:M. 중복 병합이 동작하는 순간 1이슈 N요청자가 발생하므로 Phase 1 필수(F8). 역할(요청자/대리 요청자/실사용자)과 구독 여부를 관계에 둔다.
3. **원문 전사 상시 보존** — 발화는 원문(요청자 언어)과 정규화본(팀 표준 언어)을 함께 저장한다(원칙 7). 원문 삭제 경로는 만들지 않는다.
4. **상태는 상태 머신의 것** — `session.status`의 값 집합과 전이는 코드 상태 머신이 정의한다([ADR-0001](adr/0001-fixed-orchestration.md)). DB는 전이 이력을 기록할 뿐 전이를 판단하지 않는다.

## 엔티티

### session — 요청의 라이프사이클 단위

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | 세션 ID. Linear 이슈 provenance에 그대로 쓰인다 |
| status | enum | 상태 머신 상태(ARCHITECTURE.md 상태 머신 참조) |
| terminal_state | enum? | 종결 상태 5종 중 하나. 진행 중이면 null |
| origin_channel | enum | `web` / `slack` |
| is_ui_request | bool? | 목업 단계 실행 여부 분류 결과. 분류 전 null |
| round_count | int | 명확화 왕복 수. 상한 수치는 결정 대기(§12-3) |
| prompt_version_id | fk | 세션이 사용하는 프롬프트 버전 |
| model_version | text | 모델 식별자 |
| threshold_version_id | fk | LLM 층 루브릭 임계치 버전 |
| slot_schema_version_id | fk | 필수 슬롯 스키마 버전 |
| created_at / updated_at / closed_at | ts | |

### requester — 스테이크홀더 프로필

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| display_name | text | |
| preferred_language | text | 명확화 질문·회신 언어(BCP 47) |
| timezone | text | 알림 발송 시간대(IANA) |
| channel_identities | json | 채널별 식별자(Slack user ID, 이메일 등) |

### session_requester — 세션:요청자 N:M

| 필드 | 타입 | 설명 |
|---|---|---|
| session_id / requester_id | fk | 복합 pk |
| role | enum | `requester` / `proxy` / `end_user` |
| subscribed | bool | 중복 병합 시 역보고 수신 여부 |

### utterance — 대화 발화 (원문 전사)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id | fk | |
| seq | int | 세션 내 순서 |
| author_type | enum | `requester` / `agent` / `approver` |
| author_id | fk? | requester 또는 수신자 |
| channel | enum | 발화가 일어난 채널(채널 전환 추적) |
| original_text | text | 원문. 상시 보존, 삭제 경로 없음 |
| original_language | text | |
| normalized_text | text? | 팀 표준 언어 정규화본 |
| created_at | ts | |

### slot_state — 슬롯 3상태

| 필드 | 타입 | 설명 |
|---|---|---|
| session_id | fk | 복합 pk (session_id, slot_key) |
| slot_key | text | slot_schema_version의 슬롯 식별자 |
| state | enum | `filled` / `unfilled` / `promoted` |
| value | json? | 충족 시 확정 값 |
| confirmed_by_requester | bool | 슬롯 단위 확인 완료 여부(원칙 7) |
| evidence_utterance_id | fk? | 값의 근거 발화 |
| open_issue_assignee | text? | 승격 시 담당자. 승격 판정 기준은 결정 대기(§12-4) |

### requirements_doc — 요구사항 문서 버전

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id | fk | |
| version | int | vN. 목업 vN·URL vN과 1:1 매핑 |
| content | json | 문제/사용자/스코프/스토리·수용기준/데이터 소스/오픈이슈 구조체 |
| back_injected_from | fk? | 역주입 원본 목업(vN+1 생성 시) |
| created_at | ts | |

### mockup — 목업 버전 (UI 요청 한정)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id / doc_version | fk | requirements vN과 매핑 |
| iteration | int | 반복 회차. 상한 2 vs 3은 결정 대기(§12-7) |
| hosted_url | text | 만료 서명 URL |
| expires_at | ts | |
| annotations | json | 어노테이션·코멘트(역주입 입력) |

### gate_item — 승인 게이트 항목

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id | fk | |
| approver_id | text | 라우팅으로 결정된 수신자 |
| routing_basis | text | 수신 사유("대시보드 영역 담당" 등). UI에 표시 |
| is_conditional | bool | 미해결 오픈이슈 포함 여부 |
| sla_deadline | ts | 수신자 근무시간 기준. 수치는 결정 대기(§12-5) |
| decision | enum? | `approve` / `question` / `backlog` / `reject` / null(대기) |
| reason_tag | text? | 반려·질문 시 1클릭 사유 태그(F11 귀속) |
| auto_backlogged | bool | SLA 초과 자동 전환 여부 |
| decided_at | ts? | |

### linear_issue — 생성 이슈와 provenance

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id | fk | |
| linear_issue_id | text | Linear 측 ID |
| provenance_key | text | 이슈에 남긴 기계 판독 귀속 값(커스텀 필드/라벨) |
| merged_into | text? | 중복 병합 시 대상 기존 이슈 |
| created_at | ts | |

### signal — 품질 신호 (F11)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id | fk | |
| type | enum | 게이트 결정 / 재질문 / reopen / 스펙 변경 / 목업 반복 / 역주입 누락 / 후행 피드백 / CSAT / 중도 이탈 / 승격 등 F11 표 |
| payload | json | 유형별 상세(사유 태그, diff 근거 등) |
| prompt_version_id / model_version / threshold_version_id / slot_schema_version_id | fk | 발생 시점 버전 4축(+ session_id로 5축) |
| occurred_at | ts | |

### context_ref — 컨텍스트 그라운딩 검색 기록 (F2a)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| session_id | fk | |
| source_type | enum | `linear_issue` / `requirements` / `product_doc` / `closed_session` / `gate_decision` |
| ref | text | 참조 대상 식별자 |
| used_for | text? | 어떤 질문·중복 후보의 근거였는지 |

### prompt_version / threshold_version / slot_schema_version — 버전 레지스트리

| 필드 | 타입 | 설명 |
|---|---|---|
| id | pk | |
| name / semver | text | |
| body_ref | text | 본문 위치(레지스트리 도구 참조 — Phase 2에서 채택 도구로 이관 가능) |
| regression_passed | bool | 배포 게이트 플래그. false면 런타임 로드가 코드 수준에서 불가(F12) |
| created_at | ts | |

slot_schema_version은 추가로 `slots: json`(슬롯 정의 목록)과 `derived_from: json`(슬롯 ↔ 재질문 유형 매핑 — F2e 근거)을 갖는다. 근거 없는 슬롯은 추가하지 않는다.

## 결정 대기 항목 (데이터 모델 영향분)

| 항목 | 영향 필드 | PRD 참조 |
|---|---|---|
| 명확화 왕복 상한 수치 | session.round_count 검사값 | §12-3 |
| 승격 판정 기준 | slot_state.state 전이 조건 | §12-4 |
| 게이트 SLA 수치·근무시간 정의 | gate_item.sla_deadline 산출 | §12-5 |
| 목업 반복 상한(2 vs 3) | mockup.iteration 검사값 | §12-7 |
| 백로그 재부상 트리거 수치 | 재부상 스케줄러 설정 | §12-14 |
| 과거 거절 이력 유효기간 | context_ref 필터 | §12-16 |
| 금칙 모호어 사전 | 룰 층 설정 테이블 | §12-1 |
