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
    openIssueAssignee: text('open_issue_assignee'),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.slotKey] })],
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
