import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, desc, eq, lt } from 'drizzle-orm';
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
  /** 채널 스레드 ↔ 세션 매핑 키 (예: `slack:<channel>:<thread_ts>`). */
  channelThreadKey?: string;
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

  findSessionByThreadKey(channelThreadKey: string): typeof schema.session.$inferSelect | null {
    return (
      this.db
        .select()
        .from(schema.session)
        .where(eq(schema.session.channelThreadKey, channelThreadKey))
        .get() ?? null
    );
  }

  /**
   * 상태 값 집합과 전이 규칙은 호출하는 상태 머신의 것 (ADR-0001).
   * 종결 상태를 넣으면 closedAt이 찍히고, terminalState: null은 재개(보류 해제) — closedAt도 함께 비운다.
   */
  updateSessionState(
    id: string,
    patch: {
      status?: string;
      roundCount?: number;
      terminalState?: string | null;
      /** UI 분류 결과 (F4 전제) — 문서 첫 게시 시점에 1회 기록된다. */
      isUiRequest?: boolean;
    },
  ): void {
    this.db
      .update(schema.session)
      .set({
        ...patch,
        updatedAt: now(),
        ...(patch.terminalState ? { closedAt: now() } : {}),
        ...(patch.terminalState === null ? { closedAt: null } : {}),
      })
      .where(eq(schema.session.id, id))
      .run();
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

  /**
   * 참조 전 업로드를 보관한다 (F1-Attach) — 인테이크 시점에는 세션이 없으므로 파일이 먼저 온다.
   * 검증(형식·크기·총량)은 호출자가 이미 끝낸 상태로 들어온다.
   */
  stageUpload(input: {
    filename: string;
    mime: string;
    bytes: number;
    sha256: string;
    storageRef: string;
  }): string {
    const id = randomUUID();
    this.db
      .insert(schema.stagedUpload)
      .values({ ...input, id, createdAt: now() })
      .run();
    return id;
  }

  getStagedUpload(id: string): typeof schema.stagedUpload.$inferSelect | null {
    return (
      this.db.select().from(schema.stagedUpload).where(eq(schema.stagedUpload.id, id)).get() ?? null
    );
  }

  /**
   * 업로드를 발화의 첨부로 승격한다 (ADR-0011 — 첨부는 요청자 발화에 붙는다).
   * 스테이징 행은 사라지고 원본 파일은 그대로 남는다. 알 수 없는 uploadId가 하나라도
   * 섞이면 전부 거부한다 — 요청자가 올린 자료 중 일부만 조용히 빠지는 경로를 만들지 않는다.
   */
  promoteUploads(input: {
    sessionId: string;
    utteranceId: string;
    uploadIds: string[];
  }): Array<typeof schema.attachment.$inferSelect> {
    if (input.uploadIds.length === 0) return [];
    return this.db.transaction((tx) => {
      const created: Array<typeof schema.attachment.$inferSelect> = [];
      for (const uploadId of input.uploadIds) {
        const staged = tx
          .select()
          .from(schema.stagedUpload)
          .where(eq(schema.stagedUpload.id, uploadId))
          .get();
        if (!staged) throw new Error(`알 수 없는 업로드 참조: ${uploadId}`);
        const id = randomUUID();
        tx.insert(schema.attachment)
          .values({
            id,
            sessionId: input.sessionId,
            utteranceId: input.utteranceId,
            filename: staged.filename,
            mime: staged.mime,
            bytes: staged.bytes,
            sha256: staged.sha256,
            storageRef: staged.storageRef,
            extractionStatus: 'pending',
            createdAt: now(),
          })
          .run();
        tx.delete(schema.stagedUpload).where(eq(schema.stagedUpload.id, uploadId)).run();
        const row = tx.select().from(schema.attachment).where(eq(schema.attachment.id, id)).get();
        if (!row) throw new Error(`첨부 기록 직후 조회 실패: ${id}`);
        created.push(row);
      }
      return created;
    });
  }

  listAttachments(sessionId: string): Array<typeof schema.attachment.$inferSelect> {
    return this.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.sessionId, sessionId))
      .orderBy(schema.attachment.createdAt)
      .all();
  }

  getAttachment(id: string): typeof schema.attachment.$inferSelect | null {
    return (
      this.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)).get() ?? null
    );
  }

  /**
   * 추출 결과 기록 (ADR-0011) — 첨부에서 유일하게 갱신 가능한 부분이다.
   * 재추출은 같은 행을 다시 쓴다: 추출기가 좋아지면 과거 세션에도 소급된다.
   */
  setExtraction(input: {
    id: string;
    status: 'pending' | 'ok' | 'failed';
    extractedText?: string | null;
    extractionError?: string | null;
    extractorVersion?: string;
  }): void {
    this.db
      .update(schema.attachment)
      .set({
        extractionStatus: input.status,
        extractedText: input.extractedText ?? null,
        extractionError: input.extractionError ?? null,
        ...(input.extractorVersion !== undefined
          ? { extractorVersion: input.extractorVersion }
          : {}),
        extractedAt: input.status === 'pending' ? null : now(),
      })
      .where(eq(schema.attachment.id, input.id))
      .run();
  }

  /** 장문 첨부의 압축본 저장 (#58, ADR-0014) — 원문(extracted_text)은 건드리지 않는다. */
  setCondensed(input: { id: string; condensedText: string }): void {
    this.db
      .update(schema.attachment)
      .set({ condensedText: input.condensedText })
      .where(eq(schema.attachment.id, input.id))
      .run();
  }

  /**
   * 참조되지 않은 채 남은 업로드의 메타를 정리한다. 원본 파일은 지우지 않는다 —
   * 여러 세션이 같은 내용을 가리킬 수 있어 참조 카운트 없이는 안전하지 않고,
   * 일괄 정리는 보존 기간이 정해진 뒤의 일이다(PRD §12-20).
   */
  purgeStagedUploads(olderThanIso: string): number {
    const stale = this.db
      .select({ id: schema.stagedUpload.id })
      .from(schema.stagedUpload)
      .where(lt(schema.stagedUpload.createdAt, olderThanIso))
      .all();
    for (const row of stale) {
      this.db.delete(schema.stagedUpload).where(eq(schema.stagedUpload.id, row.id)).run();
    }
    return stale.length;
  }

  /** 버전 레지스트리 3종 전체 — 트레이스 뷰어 등에서 id → name@semver 표기로 해석할 때 쓴다. */
  listVersionRegistry(): Record<
    'prompt' | 'threshold' | 'slotSchema',
    Array<{ id: string; name: string; semver: string; regressionPassed: boolean }>
  > {
    const strip = (
      rows: Array<{ id: string; name: string; semver: string; regressionPassed: boolean }>,
    ) =>
      rows.map(({ id, name, semver, regressionPassed }) => ({
        id,
        name,
        semver,
        regressionPassed,
      }));
    return {
      prompt: strip(this.db.select().from(schema.promptVersion).all()),
      threshold: strip(this.db.select().from(schema.thresholdVersion).all()),
      slotSchema: strip(this.db.select().from(schema.slotSchemaVersion).all()),
    };
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
   *
   * 첨부는 추출 결과만 담는다 — 파일명은 요청자 이름을 담고 있는 일이 잦아 빼고,
   * 원본 주소(sha256·storage_ref)는 골든셋에서 쓸모가 없다. 붙은 발화는 seq로 가리킨다.
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
    attachments: Array<{
      utteranceSeq: number | null;
      mime: string;
      bytes: number;
      extractedText: string | null;
      extractionStatus: string;
      extractionError: string | null;
      extractorVersion: string | null;
      /** 압축본 길이 (#58, ADR-0014) — 본문 대신 길이만: trace가 볼 것은 압축 여부·비율이다. */
      condensedChars: number | null;
      /** 페치 산출물의 출처 (#57, ADR-0013). 직접 업로드는 null. */
      sourceUrl: string | null;
      createdAt: string;
    }>;
    slotStates: Array<typeof schema.slotState.$inferSelect>;
    signals: Array<Omit<typeof schema.signal.$inferSelect, 'id'>>;
    documents: Array<Omit<typeof schema.requirementsDoc.$inferSelect, 'id' | 'sessionId'>>;
    /**
     * 목업 버전 (F4, #54) — 구조 층 HTML 원문은 싣지 않고 크기만 남긴다.
     * 목업 코드는 개발팀 전달 금지(하드 제약)이고, 골든셋·trace가 볼 것은 반복의 궤적이다.
     */
    mockups: Array<{
      version: number;
      docVersion: number;
      summary: string | null;
      convergence: string;
      selectedTheme: string | null;
      themeDelegated: boolean;
      htmlBytes: number;
      createdAt: string;
    }>;
    mockupAnnotations: Array<{
      mockupVersion: number | null;
      text: string;
      elementRef: string | null;
      createdAt: string;
    }>;
  }> {
    return this.db
      .select()
      .from(schema.session)
      .all()
      .map((session) => {
        const seqByUtterance = new Map(
          this.listUtterances(session.id).map((utterance) => [utterance.id, utterance.seq]),
        );
        return {
          session,
          mockups: this.listMockups(session.id).map(
            ({ id: _id, sessionId: _sessionId, html, ...rest }) => ({
              ...rest,
              htmlBytes: Buffer.byteLength(html, 'utf8'),
            }),
          ),
          mockupAnnotations: this.listMockupAnnotationsWithVersions(session.id),
          attachments: this.listAttachments(session.id).map((row) => ({
            utteranceSeq: seqByUtterance.get(row.utteranceId) ?? null,
            mime: row.mime,
            bytes: row.bytes,
            extractedText: row.extractedText,
            extractionStatus: row.extractionStatus,
            extractionError: row.extractionError,
            extractorVersion: row.extractorVersion,
            condensedChars: row.condensedText?.length ?? null,
            sourceUrl: row.sourceUrl,
            createdAt: row.createdAt,
          })),
          requesters: this.db
            .select({
              role: schema.sessionRequester.role,
              subscribed: schema.sessionRequester.subscribed,
              preferredLanguage: schema.requester.preferredLanguage,
              timezone: schema.requester.timezone,
            })
            .from(schema.sessionRequester)
            .innerJoin(
              schema.requester,
              eq(schema.sessionRequester.requesterId, schema.requester.id),
            )
            .where(eq(schema.sessionRequester.sessionId, session.id))
            .all(),
          utterances: this.listUtterances(session.id).map(
            ({ id: _id, authorId: _authorId, ...rest }) => rest,
          ),
          slotStates: this.listSlotStates(session.id),
          signals: this.listSignals(session.id).map(({ id: _id, ...rest }) => rest),
          documents: this.listRequirementsDocs(session.id).map(
            ({ id: _id, sessionId: _sessionId, ...rest }) => rest,
          ),
        };
      });
  }

  /** 슬롯 상태 기록 (upsert). 3상태 밖의 값은 거부한다 (F2c). */
  setSlotState(input: {
    sessionId: string;
    slotKey: string;
    state: 'filled' | 'unfilled' | 'promoted';
    value?: unknown;
    confirmedByRequester?: boolean;
    evidenceUtteranceId?: string;
    /** 값이 첨부에서 나왔다면 그 첨부 — 출처 표시와 추출 결함 판독의 근거 (F2c). */
    evidenceAttachmentId?: string;
    openIssueAssignee?: string;
  }): void {
    if (!['filled', 'unfilled', 'promoted'].includes(input.state)) {
      throw new Error(`슬롯 상태는 filled/unfilled/promoted 중 하나여야 한다: "${input.state}"`);
    }
    const row = {
      value: null,
      confirmedByRequester: false,
      evidenceUtteranceId: null,
      evidenceAttachmentId: null,
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
          evidenceAttachmentId: row.evidenceAttachmentId,
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

  /**
   * requirements 문서 버전 영속 (#53, G-11) — 게시마다 구조체를 vN과 함께 남긴다.
   * append-only: 같은 (세션, 버전) 재기록은 unique 제약이 거부한다. 정정은 새 버전이다.
   */
  appendRequirementsDoc(input: {
    sessionId: string;
    version: number;
    content: unknown;
    /** 역주입 원본 목업 id (F4) — 이 버전이 목업 승인에서 나왔다는 표식. */
    backInjectedFrom?: string;
  }): typeof schema.requirementsDoc.$inferSelect {
    const row = {
      id: randomUUID(),
      sessionId: input.sessionId,
      version: input.version,
      content: input.content,
      backInjectedFrom: input.backInjectedFrom ?? null,
      createdAt: now(),
    };
    this.db.insert(schema.requirementsDoc).values(row).run();
    return row;
  }

  /** 세션의 문서 버전 전부 — 버전 오름차순. 화면·역주입(F4)·골든셋의 정본 구조체. */
  listRequirementsDocs(sessionId: string): Array<typeof schema.requirementsDoc.$inferSelect> {
    return this.db
      .select()
      .from(schema.requirementsDoc)
      .where(eq(schema.requirementsDoc.sessionId, sessionId))
      .orderBy(schema.requirementsDoc.version)
      .all();
  }

  /** 최신 문서 버전 행 — 없으면 undefined (문서 전 세션 또는 #53 이전 레거시). */
  latestRequirementsDoc(sessionId: string): typeof schema.requirementsDoc.$inferSelect | undefined {
    return this.db
      .select()
      .from(schema.requirementsDoc)
      .where(eq(schema.requirementsDoc.sessionId, sessionId))
      .orderBy(desc(schema.requirementsDoc.version))
      .limit(1)
      .get();
  }

  /**
   * 목업 버전 영속 (F4, #54) — 생성·재생성마다 구조 층 HTML을 vN과 함께 남긴다.
   * append-only: 같은 (세션, 버전) 재기록은 unique 제약이 거부한다. 정정은 새 버전이다.
   */
  appendMockup(input: {
    sessionId: string;
    version: number;
    docVersion: number;
    html: string;
    summary?: string;
  }): typeof schema.mockup.$inferSelect {
    const row = {
      id: randomUUID(),
      sessionId: input.sessionId,
      version: input.version,
      docVersion: input.docVersion,
      html: input.html,
      summary: input.summary ?? null,
      convergence: 'iterating' as const,
      selectedTheme: null,
      themeDelegated: false,
      createdAt: now(),
    };
    this.db.insert(schema.mockup).values(row).run();
    return row;
  }

  /** 세션의 목업 버전 전부 — 버전 오름차순. 반복 횟수의 근거 (F4 반복 상한). */
  listMockups(sessionId: string): Array<typeof schema.mockup.$inferSelect> {
    return this.db
      .select()
      .from(schema.mockup)
      .where(eq(schema.mockup.sessionId, sessionId))
      .orderBy(schema.mockup.version)
      .all();
  }

  /** 최신 목업 행 — 반복 루프의 현재 판. 없으면 undefined (비 UI 또는 목업 전). */
  latestMockup(sessionId: string): typeof schema.mockup.$inferSelect | undefined {
    return this.db
      .select()
      .from(schema.mockup)
      .where(eq(schema.mockup.sessionId, sessionId))
      .orderBy(desc(schema.mockup.version))
      .limit(1)
      .get();
  }

  /** 특정 목업 버전 행 — 서빙 경로의 조회 (버전별 URL, F4). */
  getMockup(sessionId: string, version: number): typeof schema.mockup.$inferSelect | undefined {
    return this.db
      .select()
      .from(schema.mockup)
      .where(and(eq(schema.mockup.sessionId, sessionId), eq(schema.mockup.version, version)))
      .get();
  }

  /** 반복 루프 상태 갱신 — 수렴(승인/에스컬레이션)과 테마 선정만 바뀐다. HTML은 불변. */
  updateMockup(
    id: string,
    patch: {
      convergence?: 'iterating' | 'approved' | 'escalated';
      selectedTheme?: string | null;
      themeDelegated?: boolean;
    },
  ): void {
    this.db.update(schema.mockup).set(patch).where(eq(schema.mockup.id, id)).run();
  }

  /** 목업 어노테이션 일괄 기록 (F4) — 역주입의 원료. 원문 발화 보존은 호출자(러너) 몫. */
  addMockupAnnotations(input: {
    sessionId: string;
    mockupId: string;
    comments: Array<{ text: string; elementRef?: string }>;
  }): Array<typeof schema.mockupAnnotation.$inferSelect> {
    return input.comments.map((comment) => {
      const row = {
        id: randomUUID(),
        mockupId: input.mockupId,
        sessionId: input.sessionId,
        text: comment.text,
        elementRef: comment.elementRef ?? null,
        createdAt: now(),
      };
      this.db.insert(schema.mockupAnnotation).values(row).run();
      return row;
    });
  }

  /** 세션의 어노테이션 전부 — 시간순. 역주입 입력과 판독(F13) 표시의 근거. */
  listMockupAnnotations(sessionId: string): Array<typeof schema.mockupAnnotation.$inferSelect> {
    return this.db
      .select()
      .from(schema.mockupAnnotation)
      .where(eq(schema.mockupAnnotation.sessionId, sessionId))
      .orderBy(schema.mockupAnnotation.createdAt)
      .all();
  }

  /**
   * 어노테이션을 목업 버전과 조인한 뷰 — 역주입 입력·상태 조회·export가 같은 조형을 쓴다.
   * (mockupId는 내부 키라 버전으로 바꿔 내보낸다 — 화면·LLM 입력·골든셋 공용.)
   */
  listMockupAnnotationsWithVersions(sessionId: string): Array<{
    mockupVersion: number | null;
    text: string;
    elementRef: string | null;
    createdAt: string;
  }> {
    const versionByMockupId = new Map(
      this.listMockups(sessionId).map((mockup) => [mockup.id, mockup.version]),
    );
    return this.listMockupAnnotations(sessionId).map((annotation) => ({
      mockupVersion: versionByMockupId.get(annotation.mockupId) ?? null,
      text: annotation.text,
      elementRef: annotation.elementRef,
      createdAt: annotation.createdAt,
    }));
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
