import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { COMPLETENESS_RUBRIC_V0 } from '../src/prompts/completeness-v0';
import { runClarificationSession } from '../src/runner/local-runner';
import { SessionStore } from '../src/store/session-store';

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}
  requests: BackendRequest[] = [];

  run(request: BackendRequest): Promise<BackendResponse> {
    this.requests.push(request);
    const text = this.responses.shift();
    if (text === undefined) throw new Error('ScriptedBackend: 준비된 응답 없음');
    return Promise.resolve({ outputText: text, usage: { inputTokens: 100, outputTokens: 50 } });
  }
}

const clarificationResponse = JSON.stringify({
  interpretations: ['해석 A'],
  questions: [
    {
      question: '누가 쓰나요?',
      target: { type: 'slot', slotKey: 'target-user' },
      exampleOptions: ['매니저', '실무자'],
      dontKnowPath: { label: '모르겠어요' },
    },
    {
      question: '무엇을 보나요?',
      target: { type: 'ambiguity', description: '목적 불명' },
      exampleOptions: ['추이', '순위'],
      dontKnowPath: { label: '모르겠어요' },
    },
    {
      question: '데이터는 어디서?',
      target: { type: 'slot', slotKey: 'data-source' },
      exampleOptions: ['CRM', 'DB'],
      dontKnowPath: { label: '모르겠어요' },
    },
  ],
});

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

describe('로컬 러너 — 영속 인테이크 세션', () => {
  it('한 번의 실행으로 세션·전사·슬롯·신호가 저장소에 영속된다', async () => {
    store = SessionStore.open(':memory:');
    const backend = new ScriptedBackend([clarificationResponse]);

    const result = await runClarificationSession(
      { store, backend, registry: createDefaultRegistry(), modelVersion: 'claude-sonnet-5' },
      { request: '영업 실적 대시보드 만들어 주세요', requesterLanguage: 'ko', channel: 'web' },
    );

    expect(result.questions).toHaveLength(3);
    const exported = store.exportSessions();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      session: {
        id: result.sessionId,
        originChannel: 'web',
        modelVersion: 'claude-sonnet-5',
        status: 'clarifying',
      },
      utterances: [
        { originalText: '영업 실적 대시보드 만들어 주세요', originalLanguage: 'ko', seq: 1 },
        { authorType: 'agent', seq: 2 }, // 게시한 질문도 전사에 남는다 (원칙 7)
      ],
      slotStates: [
        { slotKey: 'data-source', state: 'unfilled' },
        { slotKey: 'target-user', state: 'unfilled' },
      ],
      signals: [{ type: 'clarification_round' }],
    });
  });

  it('반복 실행해도 카탈로그 버전은 중복 등록되지 않고 재사용된다', async () => {
    store = SessionStore.open(':memory:');
    const registry = createDefaultRegistry();
    const deps = { store, registry, modelVersion: 'claude-sonnet-5' };

    const first = await runClarificationSession(
      { ...deps, backend: new ScriptedBackend([clarificationResponse]) },
      { request: '첫 번째 요청', requesterLanguage: 'ko', channel: 'web' },
    );
    const second = await runClarificationSession(
      { ...deps, backend: new ScriptedBackend([clarificationResponse]) },
      { request: '두 번째 요청', requesterLanguage: 'ko', channel: 'slack' },
    );

    const exported = store.exportSessions();
    expect(exported).toHaveLength(2);
    expect(first.sessionId).not.toBe(second.sessionId);
    // 같은 프롬프트/임계치/슬롯 스키마 버전 행에 귀속된다 (아이덤포턴트 동기화)
    expect(exported[1]?.session.promptVersionId).toBe(exported[0]?.session.promptVersionId);
    expect(exported[1]?.session.thresholdVersionId).toBe(exported[0]?.session.thresholdVersionId);
    expect(exported[1]?.session.slotSchemaVersionId).toBe(exported[0]?.session.slotSchemaVersionId);
  });

  it('세션은 완결성 루브릭 v0 임계치 버전에 귀속된다 (#6 — 플레이스홀더 아님)', async () => {
    store = SessionStore.open(':memory:');

    await runClarificationSession(
      {
        store,
        backend: new ScriptedBackend([clarificationResponse]),
        registry: createDefaultRegistry(),
        modelVersion: 'claude-sonnet-5',
      },
      { request: '요청', requesterLanguage: 'ko', channel: 'web' },
    );

    const thresholdVersionId = store.findVersionId(
      'threshold',
      COMPLETENESS_RUBRIC_V0.name,
      COMPLETENESS_RUBRIC_V0.semver,
    );
    expect(thresholdVersionId).not.toBeNull();
    expect(store.exportSessions()[0]?.session.thresholdVersionId).toBe(thresholdVersionId);
  });
});
