import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../src/store/session-store';

const openedStores: SessionStore[] = [];

afterEach(() => {
  for (const store of openedStores.splice(0)) store.close();
});

/** 버전 레지스트리 3종을 등록하고 세션 생성에 필요한 버전 축을 돌려준다. */
function registerVersionAxes(store: SessionStore) {
  return {
    promptVersionId: store.registerPromptVersion({
      name: 'clarification',
      semver: '0.1.0',
      bodyRef: 'src/prompts/clarification/v0_1_0.ts',
      regressionPassed: false,
    }),
    modelVersion: 'claude-sonnet-5',
    thresholdVersionId: store.registerThresholdVersion({
      name: 'completeness-rubric',
      semver: '0.1.0',
      bodyRef: 'docs/thresholds/v0.md',
      regressionPassed: false,
    }),
    slotSchemaVersionId: store.registerSlotSchemaVersion({
      name: 'required-slots',
      semver: '0.1.0',
      bodyRef: 'docs/slots/v0.md',
      regressionPassed: false,
      slots: [{ key: 'target-user', label: '대상 사용자' }],
      derivedFrom: [{ slotKey: 'target-user', requestionType: '누가 쓰는 기능인지 불명' }],
    }),
  };
}

function makeStore() {
  const store = SessionStore.open(':memory:');
  openedStores.push(store);
  return { store, versionAxes: registerVersionAxes(store) };
}

describe('세션 저장소', () => {
  it('세션은 5축 버전 귀속(프롬프트·모델·임계치·슬롯 스키마 × 세션)이 고정되어 생성·조회된다', () => {
    const { store, versionAxes } = makeStore();

    const session = store.createSession({ originChannel: 'slack', ...versionAxes });
    const found = store.getSession(session.id);

    expect(found).toMatchObject({
      id: session.id,
      status: 'intake',
      originChannel: 'slack',
      roundCount: 0,
      ...versionAxes,
    });
    expect(found?.terminalState).toBeNull();
  });

  it('신호는 발생 시점 버전 5축과 함께 기록·조회된다 (F11)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });

    store.recordSignal({
      sessionId: session.id,
      type: 'gate_decision',
      payload: { decision: 'approve' },
      ...versionAxes,
    });

    const signals = store.listSignals(session.id);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      sessionId: session.id,
      type: 'gate_decision',
      payload: { decision: 'approve' },
      ...versionAxes,
    });
  });

  it('버전 축이 하나라도 빠진 신호 기록은 거부된다 (NOT NULL 강제)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });
    const base = { sessionId: session.id, type: 'requestion', payload: null, ...versionAxes };

    for (const axis of [
      'promptVersionId',
      'modelVersion',
      'thresholdVersionId',
      'slotSchemaVersionId',
    ] as const) {
      expect(() => store.recordSignal({ ...base, [axis]: undefined as unknown as string })).toThrow(
        /NOT NULL/,
      );
    }
    expect(store.listSignals(session.id)).toHaveLength(0);
  });

  it('등록된 적 없는 버전 id를 가리키는 신호 기록은 거부된다 (FK 강제)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });

    expect(() =>
      store.recordSignal({
        sessionId: session.id,
        type: 'requestion',
        payload: null,
        ...versionAxes,
        promptVersionId: 'no-such-version',
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('발화는 세션 내 순번이 자동 부여되고 원문·정규화본이 함께 보존된다', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });

    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      channel: 'slack',
      originalText: '대시보드 하나 만들어 주세요',
      originalLanguage: 'ko',
    });
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'agent',
      channel: 'slack',
      originalText: '어느 팀이 사용하나요?',
      originalLanguage: 'ko',
      normalizedText: 'Which team will use it?',
    });

    const utterances = store.listUtterances(session.id);
    expect(utterances.map((u) => u.seq)).toEqual([1, 2]);
    expect(utterances[0]).toMatchObject({
      authorType: 'requester',
      originalText: '대시보드 하나 만들어 주세요',
      originalLanguage: 'ko',
      normalizedText: null,
    });
    expect(utterances[1]).toMatchObject({ normalizedText: 'Which team will use it?' });
  });

  it('발화 원문은 우회 SQL로도 삭제·수정할 수 없다 (원칙 7 — DB 트리거)', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'pm-jude-store-')), 'store.db');
    const store = SessionStore.open(dbPath);
    openedStores.push(store);
    const versionAxes = registerVersionAxes(store);
    const session = store.createSession({ originChannel: 'web', ...versionAxes });
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      channel: 'web',
      originalText: '원문',
      originalLanguage: 'ko',
    });

    const raw = new Database(dbPath);
    try {
      expect(() => raw.prepare('DELETE FROM utterance').run()).toThrow(/immutable/);
      expect(() => raw.prepare(`UPDATE utterance SET original_text = '변조'`).run()).toThrow(
        /immutable/,
      );
      // 정규화본 갱신은 허용 경로다 (원문이 아니므로)
      raw.prepare(`UPDATE utterance SET normalized_text = 'normalized'`).run();
    } finally {
      raw.close();
    }
    expect(store.listUtterances(session.id)[0]).toMatchObject({
      originalText: '원문',
      normalizedText: 'normalized',
    });
  });

  it('슬롯 3상태(충족/미충족/승격)를 기록·갱신·조회한다 (F2c)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });

    store.setSlotState({ sessionId: session.id, slotKey: 'target-user', state: 'unfilled' });
    store.setSlotState({
      sessionId: session.id,
      slotKey: 'target-user',
      state: 'filled',
      value: { answer: '영업팀 매니저' },
      confirmedByRequester: true,
    });
    store.setSlotState({
      sessionId: session.id,
      slotKey: 'data-source',
      state: 'promoted',
      openIssueAssignee: 'dev-lead',
    });

    const slots = store.listSlotStates(session.id);
    expect(slots).toHaveLength(2);
    expect(slots.find((s) => s.slotKey === 'target-user')).toMatchObject({
      state: 'filled',
      value: { answer: '영업팀 매니저' },
      confirmedByRequester: true,
    });
    expect(slots.find((s) => s.slotKey === 'data-source')).toMatchObject({
      state: 'promoted',
      openIssueAssignee: 'dev-lead',
    });
  });

  it('3상태 밖의 슬롯 상태는 거부된다', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });

    expect(() =>
      store.setSlotState({
        sessionId: session.id,
        slotKey: 'target-user',
        state: 'maybe' as never,
      }),
    ).toThrow(/슬롯 상태/);
  });

  it('버전 레지스트리 3종을 name+semver로 조회하고, 미등록이면 null을 돌려준다', () => {
    const { store, versionAxes } = makeStore();

    expect(store.findVersionId('prompt', 'clarification', '0.1.0')).toBe(
      versionAxes.promptVersionId,
    );
    expect(store.findVersionId('threshold', 'completeness-rubric', '0.1.0')).toBe(
      versionAxes.thresholdVersionId,
    );
    expect(store.findVersionId('slot_schema', 'required-slots', '0.1.0')).toBe(
      versionAxes.slotSchemaVersionId,
    );
    expect(store.findVersionId('prompt', 'clarification', '9.9.9')).toBeNull();
  });

  it('요청자는 역할·구독 여부와 함께 세션에 N:M으로 연결된다', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });
    const requesterId = store.addRequester({
      displayName: '김민수',
      preferredLanguage: 'ko',
      timezone: 'Asia/Seoul',
      channelIdentities: { slackUserId: 'U12345' },
    });
    const proxyId = store.addRequester({
      displayName: 'Ana Souza',
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      channelIdentities: { email: 'ana@example.com' },
    });

    store.linkRequester({ sessionId: session.id, requesterId, role: 'requester' });
    store.linkRequester({
      sessionId: session.id,
      requesterId: proxyId,
      role: 'proxy',
      subscribed: false,
    });

    const links = store.listSessionRequesters(session.id);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.requesterId === requesterId)).toMatchObject({
      role: 'requester',
      subscribed: true,
    });
    expect(links.find((l) => l.requesterId === proxyId)).toMatchObject({
      role: 'proxy',
      subscribed: false,
    });
  });

  it('세션 export는 요청자 식별 정보를 제거하고 전사·슬롯·신호를 담는다 (골든셋 시드)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });
    const requesterId = store.addRequester({
      displayName: '김민수',
      preferredLanguage: 'ko',
      timezone: 'Asia/Seoul',
      channelIdentities: { slackUserId: 'U12345' },
    });
    store.linkRequester({ sessionId: session.id, requesterId, role: 'requester' });
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      authorId: requesterId,
      channel: 'slack',
      originalText: '대시보드 하나 만들어 주세요',
      originalLanguage: 'ko',
    });
    store.setSlotState({ sessionId: session.id, slotKey: 'target-user', state: 'unfilled' });
    store.recordSignal({
      sessionId: session.id,
      type: 'session_abandoned',
      payload: null,
      ...versionAxes,
    });

    const exported = store.exportSessions();

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      session: { id: session.id, originChannel: 'slack', ...versionAxes },
      requesters: [{ role: 'requester', subscribed: true, preferredLanguage: 'ko' }],
      utterances: [{ seq: 1, originalText: '대시보드 하나 만들어 주세요' }],
      slotStates: [{ slotKey: 'target-user', state: 'unfilled' }],
      signals: [{ type: 'session_abandoned' }],
    });
    // 익명화: 이름·채널 식별자·발화 작성자 id가 어디에도 남지 않는다
    const dump = JSON.stringify(exported);
    expect(dump).not.toContain('김민수');
    expect(dump).not.toContain('U12345');
    expect(dump).not.toContain(requesterId);
  });
});

describe('첨부 자료 (F1-Attach, ADR-0011)', () => {
  /** 업로드 하나를 승격하고 그 첨부 행을 돌려준다 — 테스트마다 배열을 벗기지 않기 위해. */
  function promoteOne(
    store: SessionStore,
    input: { sessionId: string; utteranceId: string; uploadId: string },
  ) {
    const [row] = store.promoteUploads({
      sessionId: input.sessionId,
      utteranceId: input.utteranceId,
      uploadIds: [input.uploadId],
    });
    if (!row) throw new Error('첨부 승격 결과가 비어 있다');
    return row;
  }

  /** 요청자 발화 하나와 그 발화에 붙일 스테이징 업로드를 준비한다. */
  function makeSessionWithUpload() {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'web', ...versionAxes });
    const utterance = store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      channel: 'web',
      originalText: '이 기획서대로 만들어 주세요',
      originalLanguage: 'ko',
    });
    const uploadId = store.stageUpload({
      filename: '기획서.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: 2048,
      sha256: 'a'.repeat(64),
      storageRef: `aa/${'a'.repeat(64)}`,
    });
    return { store, versionAxes, session, utterance, uploadId };
  }

  it('업로드는 스테이징을 거쳐 발화의 첨부로 승격되고, 스테이징 행은 사라진다', () => {
    const { store, session, utterance, uploadId } = makeSessionWithUpload();

    expect(store.getStagedUpload(uploadId)).not.toBeNull();
    const created = store.promoteUploads({
      sessionId: session.id,
      utteranceId: utterance.id,
      uploadIds: [uploadId],
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      utteranceId: utterance.id,
      filename: '기획서.docx',
      bytes: 2048,
      extractionStatus: 'pending',
      extractedText: null,
    });
    expect(store.getStagedUpload(uploadId)).toBeNull();
    expect(store.listAttachments(session.id)).toHaveLength(1);
  });

  it('알 수 없는 업로드가 섞이면 전부 거부한다 — 일부만 조용히 빠지지 않는다', () => {
    const { store, session, utterance, uploadId } = makeSessionWithUpload();

    expect(() =>
      store.promoteUploads({
        sessionId: session.id,
        utteranceId: utterance.id,
        uploadIds: [uploadId, 'no-such-upload'],
      }),
    ).toThrow(/알 수 없는 업로드/);

    expect(store.listAttachments(session.id)).toHaveLength(0);
    expect(store.getStagedUpload(uploadId)).not.toBeNull(); // 롤백되어 다시 쓸 수 있다
  });

  it('추출 결과는 갱신되지만 원본은 우회 SQL로도 삭제·수정할 수 없다 (ADR-0011 — DB 트리거)', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'pm-jude-attach-')), 'store.db');
    const store = SessionStore.open(dbPath);
    openedStores.push(store);
    const versionAxes = registerVersionAxes(store);
    const session = store.createSession({ originChannel: 'web', ...versionAxes });
    const utterance = store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      channel: 'web',
      originalText: '자료 첨부합니다',
      originalLanguage: 'ko',
    });
    const uploadId = store.stageUpload({
      filename: 'spec.pdf',
      mime: 'application/pdf',
      bytes: 1024,
      sha256: 'b'.repeat(64),
      storageRef: `bb/${'b'.repeat(64)}`,
    });
    const row = promoteOne(store, {
      sessionId: session.id,
      utteranceId: utterance.id,
      uploadId,
    });

    // 추출은 갱신 경로다 — 추출기가 좋아지면 과거 세션에도 소급된다
    store.setExtraction({
      id: row.id,
      status: 'ok',
      extractedText: '문제: 주간 매출 확인',
      extractorVersion: 'pdf-text@0.1.0',
    });
    expect(store.getAttachment(row.id)).toMatchObject({
      extractionStatus: 'ok',
      extractedText: '문제: 주간 매출 확인',
      extractorVersion: 'pdf-text@0.1.0',
    });
    store.setExtraction({
      id: row.id,
      status: 'ok',
      extractedText: '재추출 결과',
      extractorVersion: 'pdf-text@0.2.0',
    });
    expect(store.getAttachment(row.id)?.extractedText).toBe('재추출 결과');

    const raw = new Database(dbPath);
    try {
      expect(() => raw.prepare('DELETE FROM attachment').run()).toThrow(/immutable/);
      expect(() => raw.prepare(`UPDATE attachment SET sha256 = 'tampered'`).run()).toThrow(
        /immutable/,
      );
      expect(() => raw.prepare(`UPDATE attachment SET filename = '다른이름.pdf'`).run()).toThrow(
        /immutable/,
      );
    } finally {
      raw.close();
    }
    expect(store.getAttachment(row.id)).toMatchObject({
      filename: 'spec.pdf',
      sha256: 'b'.repeat(64),
    });
  });

  it('슬롯 값의 근거로 첨부를 가리킬 수 있다 (F2c — 출처 표시의 전제)', () => {
    const { store, session, utterance, uploadId } = makeSessionWithUpload();
    const attachment = promoteOne(store, {
      sessionId: session.id,
      utteranceId: utterance.id,
      uploadId,
    });

    store.setSlotState({
      sessionId: session.id,
      slotKey: 'target-user',
      state: 'filled',
      value: '영업팀 매니저',
      evidenceAttachmentId: attachment.id,
    });

    expect(store.listSlotStates(session.id)[0]).toMatchObject({
      state: 'filled',
      evidenceAttachmentId: attachment.id,
      evidenceUtteranceId: null,
    });
  });

  it('등록되지 않은 첨부를 슬롯 근거로 가리킬 수 없다 (FK 강제)', () => {
    const { store, session } = makeSessionWithUpload();

    expect(() =>
      store.setSlotState({
        sessionId: session.id,
        slotKey: 'target-user',
        state: 'filled',
        evidenceAttachmentId: 'no-such-attachment',
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('참조되지 않은 채 오래된 업로드는 메타가 정리된다', () => {
    const { store, uploadId } = makeSessionWithUpload();

    expect(store.purgeStagedUploads('2000-01-01T00:00:00.000Z')).toBe(0);
    expect(store.getStagedUpload(uploadId)).not.toBeNull();

    expect(store.purgeStagedUploads(new Date(Date.now() + 60_000).toISOString())).toBe(1);
    expect(store.getStagedUpload(uploadId)).toBeNull();
  });

  it('세션 export의 첨부는 추출 결과만 담고 파일명·원본 주소는 빼놓는다', () => {
    const { store, session, utterance, uploadId } = makeSessionWithUpload();
    const attachment = promoteOne(store, {
      sessionId: session.id,
      utteranceId: utterance.id,
      uploadId,
    });
    store.setExtraction({
      id: attachment.id,
      status: 'ok',
      extractedText: '대상 사용자: 영업팀 매니저',
      extractorVersion: 'ooxml@0.1.0',
    });

    const exported = store.exportSessions();

    expect(exported[0]?.attachments).toEqual([
      {
        utteranceSeq: 1,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: 2048,
        extractedText: '대상 사용자: 영업팀 매니저',
        extractionStatus: 'ok',
        extractionError: null,
        extractorVersion: 'ooxml@0.1.0',
        condensedChars: null, // 압축본은 길이만 — 본문은 export에 싣지 않는다 (#58)
        sourceUrl: null, // 직접 업로드 — 페치 출처 없음 (#57)
        createdAt: attachment.createdAt,
      },
    ]);
    const dump = JSON.stringify(exported);
    expect(dump).not.toContain('기획서.docx');
    expect(dump).not.toContain('a'.repeat(64));
  });
});

describe('채널 스레드 매핑과 상태 전이 (#8 Slack 러너 지원)', () => {
  it('채널 스레드 키로 세션을 찾을 수 있다 — 재시작 후에도 스레드가 세션에 이어진다', () => {
    const { store, versionAxes } = makeStore();

    const session = store.createSession({
      originChannel: 'slack',
      channelThreadKey: 'slack:C0123:1719999999.000100',
      ...versionAxes,
    });

    expect(store.findSessionByThreadKey('slack:C0123:1719999999.000100')?.id).toBe(session.id);
    expect(store.findSessionByThreadKey('slack:C0123:없는스레드')).toBeNull();
  });

  it('상태·왕복 수·종결 상태를 갱신할 수 있고, 종결 시 closedAt이 남는다', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });

    store.updateSessionState(session.id, { status: 'clarifying', roundCount: 1 });
    expect(store.getSession(session.id)).toMatchObject({
      status: 'clarifying',
      roundCount: 1,
      closedAt: null,
    });

    store.updateSessionState(session.id, {
      status: 'closed',
      terminalState: 'on_hold_insufficient_info',
    });
    const closed = store.getSession(session.id);
    expect(closed).toMatchObject({
      status: 'closed',
      terminalState: 'on_hold_insufficient_info',
      roundCount: 1, // 갱신하지 않은 필드는 유지된다
    });
    expect(closed?.closedAt).not.toBeNull();
  });
});

describe('requirements_doc 영속 (#53)', () => {
  const content = {
    problem: '영업 실적을 정리해 볼 수단이 없다',
    users: ['영업팀 매니저'],
    scope: { inScope: ['월별 매출 추이 조회'], outOfScope: [] },
    stories: [
      {
        story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 기간을 선택하면, the system shall 월별 합계를 표시한다',
            gwt: {
              given: '매출 데이터가 있을 때',
              when: '기간을 선택하면',
              then: '합계가 표시된다',
            },
          },
        ],
      },
    ],
    dataSources: ['CRM'],
    openIssues: [],
  };

  it('문서 구조체가 버전과 함께 영속되고 버전 오름차순으로 조회된다', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'web', ...versionAxes });

    store.appendRequirementsDoc({ sessionId: session.id, version: 1, content });
    store.appendRequirementsDoc({
      sessionId: session.id,
      version: 2,
      content: { ...content, problem: '정정된 문제 정의' },
    });

    const docs = store.listRequirementsDocs(session.id);
    expect(docs.map((doc) => doc.version)).toEqual([1, 2]);
    expect(docs[0]?.content).toMatchObject({ problem: '영업 실적을 정리해 볼 수단이 없다' });
    expect(docs[1]?.content).toMatchObject({ problem: '정정된 문제 정의' });
    expect(docs[0]?.backInjectedFrom).toBeNull(); // 역주입(F4)은 Phase 2 — 그 전까지 null
    expect(docs[0]?.createdAt).toBeTruthy();
  });

  it('같은 세션의 같은 버전은 거부된다 — 버전은 게시 이력이지 덮어쓰기가 아니다 (G-11)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'web', ...versionAxes });
    store.appendRequirementsDoc({ sessionId: session.id, version: 1, content });

    expect(() =>
      store.appendRequirementsDoc({ sessionId: session.id, version: 1, content }),
    ).toThrow();
  });

  it('익명화 export에 문서 버전·구조체가 실린다 — 골든셋·trace의 입력 (F12)', () => {
    const { store, versionAxes } = makeStore();
    const session = store.createSession({ originChannel: 'web', ...versionAxes });
    store.appendRequirementsDoc({ sessionId: session.id, version: 1, content });

    const exported = store.exportSessions()[0];
    expect(exported?.documents).toHaveLength(1);
    expect(exported?.documents[0]).toMatchObject({ version: 1 });
    expect(exported?.documents[0]?.content).toMatchObject({ problem: content.problem });
  });
});
