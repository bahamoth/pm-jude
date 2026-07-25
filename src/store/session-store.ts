import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export interface VersionInput {
  name: string;
  semver: string;
  bodyRef: string;
  regressionPassed: boolean;
}

export interface SlotSchemaVersionInput extends VersionInput {
  slots: unknown;
  derivedFrom: unknown;
}

export interface CreateSessionInput {
  originChannel: 'web' | 'slack';
  promptVersionId: string;
  modelVersion: string;
  thresholdVersionId: string;
  slotSchemaVersionId: string;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Phase 0 세션 저장소 (ADR-0006 — SQLite).
 * 세션·전사·슬롯·신호를 버전 귀속 5축과 함께 기록한다.
 * 원문 전사(utterance.original_text)에는 삭제·수정 경로가 없다 (원칙 7).
 */
export class SessionStore {
  private constructor(
    private readonly sqlite: Database.Database,
    private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  static open(path: string): SessionStore {
    const sqlite = new Database(path);
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return new SessionStore(sqlite, db);
  }

  close(): void {
    this.sqlite.close();
  }

  registerPromptVersion(input: VersionInput): string {
    const id = randomUUID();
    this.db
      .insert(schema.promptVersion)
      .values({ ...input, id, createdAt: now() })
      .run();
    return id;
  }

  registerThresholdVersion(input: VersionInput): string {
    const id = randomUUID();
    this.db
      .insert(schema.thresholdVersion)
      .values({ ...input, id, createdAt: now() })
      .run();
    return id;
  }

  registerSlotSchemaVersion(input: SlotSchemaVersionInput): string {
    const id = randomUUID();
    this.db
      .insert(schema.slotSchemaVersion)
      .values({ ...input, id, createdAt: now() })
      .run();
    return id;
  }

  createSession(input: CreateSessionInput): typeof schema.session.$inferSelect {
    const id = randomUUID();
    const ts = now();
    this.db
      .insert(schema.session)
      .values({ ...input, id, status: 'intake', createdAt: ts, updatedAt: ts })
      .run();
    const created = this.getSession(id);
    if (!created) throw new Error(`세션 생성 직후 조회 실패: ${id}`);
    return created;
  }

  getSession(id: string): typeof schema.session.$inferSelect | null {
    return this.db.select().from(schema.session).where(eq(schema.session.id, id)).get() ?? null;
  }

  /** 발화 기록. 세션 내 순번(seq)을 자동 부여하며, 원문은 이후 삭제·수정할 수 없다 (원칙 7). */
  appendUtterance(input: {
    sessionId: string;
    authorType: 'requester' | 'agent' | 'approver';
    authorId?: string;
    channel: 'web' | 'slack';
    originalText: string;
    originalLanguage: string;
    normalizedText?: string;
  }): typeof schema.utterance.$inferSelect {
    return this.db.transaction((tx) => {
      const last = tx
        .select({ seq: schema.utterance.seq })
        .from(schema.utterance)
        .where(eq(schema.utterance.sessionId, input.sessionId))
        .orderBy(desc(schema.utterance.seq))
        .limit(1)
        .get();
      const row = {
        ...input,
        id: randomUUID(),
        seq: (last?.seq ?? 0) + 1,
        createdAt: now(),
      };
      tx.insert(schema.utterance).values(row).run();
      const created = tx
        .select()
        .from(schema.utterance)
        .where(eq(schema.utterance.id, row.id))
        .get();
      if (!created) throw new Error(`발화 기록 직후 조회 실패: ${row.id}`);
      return created;
    });
  }

  listUtterances(sessionId: string): Array<typeof schema.utterance.$inferSelect> {
    return this.db
      .select()
      .from(schema.utterance)
      .where(eq(schema.utterance.sessionId, sessionId))
      .orderBy(schema.utterance.seq)
      .all();
  }

  /** 버전 레지스트리 3종에서 name+semver로 id를 찾는다. 미등록이면 null. */
  findVersionId(
    kind: 'prompt' | 'threshold' | 'slot_schema',
    name: string,
    semver: string,
  ): string | null {
    const table = {
      prompt: schema.promptVersion,
      threshold: schema.thresholdVersion,
      slot_schema: schema.slotSchemaVersion,
    }[kind];
    const row = this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.name, name), eq(table.semver, semver)))
      .get();
    return row?.id ?? null;
  }

  addRequester(input: {
    displayName: string;
    preferredLanguage: string;
    timezone: string;
    channelIdentities: unknown;
  }): string {
    const id = randomUUID();
    this.db
      .insert(schema.requester)
      .values({ ...input, id })
      .run();
    return id;
  }

  linkRequester(input: {
    sessionId: string;
    requesterId: string;
    role: 'requester' | 'proxy' | 'end_user';
    subscribed?: boolean;
  }): void {
    this.db.insert(schema.sessionRequester).values(input).run();
  }

  listSessionRequesters(sessionId: string): Array<typeof schema.sessionRequester.$inferSelect> {
    return this.db
      .select()
      .from(schema.sessionRequester)
      .where(eq(schema.sessionRequester.sessionId, sessionId))
      .all();
  }

  /**
   * PoC 세션 export — 골든셋 시드용 익명화 뷰 (F12, §6 평가 데이터 프라이버시).
   * 요청자 식별 정보(id·이름·채널 식별자)와 발화 작성자 id를 제거하고
   * 전사·슬롯·신호·버전 귀속을 그대로 담는다.
   */
  exportSessions(): Array<{
    session: Omit<typeof schema.session.$inferSelect, never>;
    requesters: Array<{
      role: string;
      subscribed: boolean;
      preferredLanguage: string;
      timezone: string;
    }>;
    utterances: Array<Omit<typeof schema.utterance.$inferSelect, 'id' | 'authorId'>>;
    slotStates: Array<typeof schema.slotState.$inferSelect>;
    signals: Array<Omit<typeof schema.signal.$inferSelect, 'id'>>;
  }> {
    return this.db
      .select()
      .from(schema.session)
      .all()
      .map((session) => ({
        session,
        requesters: this.db
          .select({
            role: schema.sessionRequester.role,
            subscribed: schema.sessionRequester.subscribed,
            preferredLanguage: schema.requester.preferredLanguage,
            timezone: schema.requester.timezone,
          })
          .from(schema.sessionRequester)
          .innerJoin(schema.requester, eq(schema.sessionRequester.requesterId, schema.requester.id))
          .where(eq(schema.sessionRequester.sessionId, session.id))
          .all(),
        utterances: this.listUtterances(session.id).map(
          ({ id: _id, authorId: _authorId, ...rest }) => rest,
        ),
        slotStates: this.listSlotStates(session.id),
        signals: this.listSignals(session.id).map(({ id: _id, ...rest }) => rest),
      }));
  }

  /** 슬롯 상태 기록 (upsert). 3상태 밖의 값은 거부한다 (F2c). */
  setSlotState(input: {
    sessionId: string;
    slotKey: string;
    state: 'filled' | 'unfilled' | 'promoted';
    value?: unknown;
    confirmedByRequester?: boolean;
    evidenceUtteranceId?: string;
    openIssueAssignee?: string;
  }): void {
    if (!['filled', 'unfilled', 'promoted'].includes(input.state)) {
      throw new Error(`슬롯 상태는 filled/unfilled/promoted 중 하나여야 한다: "${input.state}"`);
    }
    const row = {
      value: null,
      confirmedByRequester: false,
      evidenceUtteranceId: null,
      openIssueAssignee: null,
      ...input,
    };
    this.db
      .insert(schema.slotState)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.slotState.sessionId, schema.slotState.slotKey],
        set: {
          state: row.state,
          value: row.value,
          confirmedByRequester: row.confirmedByRequester,
          evidenceUtteranceId: row.evidenceUtteranceId,
          openIssueAssignee: row.openIssueAssignee,
        },
      })
      .run();
  }

  listSlotStates(sessionId: string): Array<typeof schema.slotState.$inferSelect> {
    return this.db
      .select()
      .from(schema.slotState)
      .where(eq(schema.slotState.sessionId, sessionId))
      .orderBy(schema.slotState.slotKey)
      .all();
  }

  /** 신호 기록 (F11). 버전 5축은 스키마 NOT NULL + FK로 강제된다. */
  recordSignal(input: {
    sessionId: string;
    type: string;
    payload: unknown;
    promptVersionId: string;
    modelVersion: string;
    thresholdVersionId: string;
    slotSchemaVersionId: string;
  }): void {
    this.db
      .insert(schema.signal)
      .values({ ...input, id: randomUUID(), occurredAt: now() })
      .run();
  }

  listSignals(sessionId: string): Array<typeof schema.signal.$inferSelect> {
    return this.db.select().from(schema.signal).where(eq(schema.signal.sessionId, sessionId)).all();
  }
}
