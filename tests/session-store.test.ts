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
