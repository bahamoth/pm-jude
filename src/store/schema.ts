import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// 세션 저장소 스키마 (docs/data-model.md의 Phase 0 필요분, ADR-0006).
// SQLite 전용 기능에 의존하지 않는다 — Phase 1 Postgres 전환 전제.
// 타임스탬프는 ISO-8601 텍스트, id는 UUID 텍스트.

/** 버전 레지스트리 3종의 공통 컬럼 (F12 — regression_passed는 배포 게이트 플래그). */
const versionColumns = {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  semver: text('semver').notNull(),
  bodyRef: text('body_ref').notNull(),
  regressionPassed: integer('regression_passed', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
};

export const promptVersion = sqliteTable('prompt_version', {
  ...versionColumns,
});

export const thresholdVersion = sqliteTable('threshold_version', {
  ...versionColumns,
});

export const slotSchemaVersion = sqliteTable('slot_schema_version', {
  ...versionColumns,
  /** 슬롯 정의 목록. */
  slots: text('slots', { mode: 'json' }).notNull(),
  /** 슬롯 ↔ 재질문 유형 매핑 — F2e 근거. 근거 없는 슬롯은 추가하지 않는다. */
  derivedFrom: text('derived_from', { mode: 'json' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  /** 상태 값 집합과 전이는 코드 상태 머신의 것 (ADR-0001). DB는 기록만 한다. */
  status: text('status').notNull(),
  terminalState: text('terminal_state'),
  originChannel: text('origin_channel', { enum: ['web', 'slack'] }).notNull(),
  /** 채널 스레드 ↔ 세션 매핑 키 (예: `slack:<channel>:<thread_ts>`) — 어댑터 재시작에도 스레드가 세션에 이어진다. */
  channelThreadKey: text('channel_thread_key').unique(),
  isUiRequest: integer('is_ui_request', { mode: 'boolean' }),
  roundCount: integer('round_count').notNull().default(0),
  // 버전 귀속 5축 — 세션 생성 시점의 버전을 고정 기록 (F11)
  promptVersionId: text('prompt_version_id')
    .notNull()
    .references(() => promptVersion.id),
  modelVersion: text('model_version').notNull(),
  thresholdVersionId: text('threshold_version_id')
    .notNull()
    .references(() => thresholdVersion.id),
  slotSchemaVersionId: text('slot_schema_version_id')
    .notNull()
    .references(() => slotSchemaVersion.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  closedAt: text('closed_at'),
});

export const requester = sqliteTable('requester', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  /** BCP 47 — 명확화 질문·회신 언어. */
  preferredLanguage: text('preferred_language').notNull(),
  /** IANA — 알림 발송 시간대. */
  timezone: text('timezone').notNull(),
  /** 채널별 식별자 (Slack user ID, 이메일 등). */
  channelIdentities: text('channel_identities', { mode: 'json' }).notNull(),
});

export const sessionRequester = sqliteTable(
  'session_requester',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    requesterId: text('requester_id')
      .notNull()
      .references(() => requester.id),
    role: text('role', { enum: ['requester', 'proxy', 'end_user'] }).notNull(),
    /** 중복 병합 시 역보고 수신 여부 (F8). */
    subscribed: integer('subscribed', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.requesterId] })],
);

export const utterance = sqliteTable(
  'utterance',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    seq: integer('seq').notNull(),
    authorType: text('author_type', { enum: ['requester', 'agent', 'approver'] }).notNull(),
    authorId: text('author_id'),
    channel: text('channel', { enum: ['web', 'slack'] }).notNull(),
    /** 원문. 상시 보존 — 삭제·수정 경로 없음 (원칙 7, 트리거로 강제). */
    originalText: text('original_text').notNull(),
    originalLanguage: text('original_language').notNull(),
    normalizedText: text('normalized_text'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique().on(table.sessionId, table.seq)],
);

/**
 * 참조되기 전의 업로드 (F1-Attach) — 인테이크 시점에는 세션이 아직 없으므로 파일을 먼저 받고
 * 발화 제출이 uploadId로 참조한다. 참조되면 attachment로 승격하고 이 행은 사라진다.
 * 미참조 행은 TTL로 정리한다 — 원본 파일은 남긴다(불변 규율, 보존 정책은 PRD §12-20).
 */
export const stagedUpload = sqliteTable('staged_upload', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  storageRef: text('storage_ref').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * 첨부 자료 (F1-Attach, ADR-0011) — 발화에 붙는다. 첨부만 단독으로 존재하는 행은 없다.
 * 원본(sha256·storage_ref)은 불변이고 추출 텍스트만 갱신된다 — 추출기 개선이 과거 세션에도
 * 소급 가능해야 하므로(재추출 전제) 원문 전사의 불변 규율을 그대로 적용하지 않는다.
 */
export const attachment = sqliteTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    /** 첨부가 붙은 요청자 발화 — 첨부 시점이 전사 순서로 남는다. */
    utteranceId: text('utterance_id')
      .notNull()
      .references(() => utterance.id),
    filename: text('filename').notNull(),
    /** 추출기 선택 키. 미등록 MIME은 업로드 시점에 거부되므로 여기 도달하지 않는다. */
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    /** 원본 주소. 같은 파일의 재업로드는 저장 1회. */
    sha256: text('sha256').notNull(),
    storageRef: text('storage_ref').notNull(),
    /** 추출 결과 — 이 테이블에서 유일하게 갱신 가능한 내용 필드. */
    extractedText: text('extracted_text'),
    extractionStatus: text('extraction_status', { enum: ['pending', 'ok', 'failed'] })
      .notNull()
      .default('pending'),
    /** 실패 사유(암호화·손상·빈 텍스트 레이어 등) — 요청자 고지의 근거. */
    extractionError: text('extraction_error'),
    /** 추출 시점의 추출기 버전. 버전 축은 5축을 유지하고 이 값은 메타로만 남는다 (ADR-0011). */
    extractorVersion: text('extractor_version'),
    createdAt: text('created_at').notNull(),
    extractedAt: text('extracted_at'),
  },
  (table) => [index('attachment_session_idx').on(table.sessionId)],
);

export const slotState = sqliteTable(
  'slot_state',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    slotKey: text('slot_key').notNull(),
    /** 슬롯 3상태 (F2c). */
    state: text('state', { enum: ['filled', 'unfilled', 'promoted'] }).notNull(),
    value: text('value', { mode: 'json' }),
    confirmedByRequester: integer('confirmed_by_requester', { mode: 'boolean' })
      .notNull()
      .default(false),
    evidenceUtteranceId: text('evidence_utterance_id').references(() => utterance.id),
    /** 값의 근거 첨부 — 요청자가 말한 적 없는 값의 출처 표시와 추출 결함 판독의 근거 (F2c). */
    evidenceAttachmentId: text('evidence_attachment_id').references(() => attachment.id),
    openIssueAssignee: text('open_issue_assignee'),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.slotKey] })],
);

/**
 * requirements 문서 버전 (#53, data-model.md) — 게시마다 구조체와 vN을 영속한다.
 * 발화로 남는 게시 텍스트는 전달 표면이고, 구현·역주입(F4)·화면 렌더의 정본은 이 구조체다.
 * 행은 append-only — 정정은 새 버전을 만들지 기존 행을 고치지 않는다 (G-11).
 */
export const requirementsDoc = sqliteTable(
  'requirements_doc',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    /** vN — 목업 vN·URL vN과 1:1 매핑 예정 (F4). */
    version: integer('version').notNull(),
    /** 문제/사용자/스코프/스토리·수용기준/데이터 소스/오픈이슈 구조체. */
    content: text('content', { mode: 'json' }).notNull(),
    /** 역주입 원본 목업 (F4, Phase 2) — mockup 테이블 도입 전까지 null. */
    backInjectedFrom: text('back_injected_from'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique().on(table.sessionId, table.version)],
);

/**
 * 목업 (F4, #54) — requirements vN을 시각화한 중간충실도 인터랙티브 HTML의 버전 행.
 * html은 구조 층(--pj-* 테마 토큰 소비, 그레이스케일 기본값)이고 테마·워터마크는 서빙 시점에
 * 코드가 입힌다 — 테마 교체에 LLM 재생성이 없다. 버전 행은 append-only이고, 반복 루프의
 * 수렴·테마 선정만 최신 행에 갱신된다(이력은 신호가 진다).
 */
export const mockup = sqliteTable(
  'mockup',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    /** 목업 vN (F4 버전 매핑). */
    version: integer('version').notNull(),
    /** 이 판이 시각화한 requirements 문서 버전 — 문서 vN ↔ 목업 vN 매핑의 실체. */
    docVersion: integer('doc_version').notNull(),
    /** 구조 층 self-contained HTML. 개발팀 전달 금지 — URL·이미지 형태만 (F4 하드 제약). */
    html: text('html').notNull(),
    /** 이 판에 반영된 것의 요약 — 요청자 회신과 trace 표시용. */
    summary: text('summary'),
    /** 반복 루프 상태 — iterating에서 approved(승인·역주입) 또는 escalated(상한 초과)로. */
    convergence: text('convergence', { enum: ['iterating', 'approved', 'escalated'] })
      .notNull()
      .default('iterating'),
    /** 선정된 디자인 시스템 테마 id. 위임이면 null + themeDelegated. */
    selectedTheme: text('selected_theme'),
    /** 「개발팀이 정하는 게 좋겠다」 — 승격과 같은 정신의 1클릭 위임 (F4 선정). */
    themeDelegated: integer('theme_delegated', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique().on(table.sessionId, table.version)],
);

/**
 * 목업 어노테이션 (F4) — 요청자가 목업 위에 남긴 정정 요청·코멘트. 역주입의 원료이며
 * 승인 시 확정 사항이 requirements vN+1 문장으로 흡수된다. 원문은 발화로도 보존된다(원칙 7).
 */
export const mockupAnnotation = sqliteTable(
  'mockup_annotation',
  {
    id: text('id').primaryKey(),
    mockupId: text('mockup_id')
      .notNull()
      .references(() => mockup.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    /** 요청자 언어 그대로의 코멘트 원문. */
    text: text('text').notNull(),
    /** 목업 안의 대상 요소 참조 (선택) — Phase 0 텍스트 어노테이션의 최소 앵커. */
    elementRef: text('element_ref'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('mockup_annotation_session_idx').on(table.sessionId)],
);

export const signal = sqliteTable(
  'signal',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }),
    // 발생 시점 버전 4축(+ session_id로 5축) — F11, NOT NULL 강제
    promptVersionId: text('prompt_version_id')
      .notNull()
      .references(() => promptVersion.id),
    modelVersion: text('model_version').notNull(),
    thresholdVersionId: text('threshold_version_id')
      .notNull()
      .references(() => thresholdVersion.id),
    slotSchemaVersionId: text('slot_schema_version_id')
      .notNull()
      .references(() => slotSchemaVersion.id),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [index('signal_session_idx').on(table.sessionId)],
);
