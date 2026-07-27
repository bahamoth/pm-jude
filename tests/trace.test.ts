import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { runClarificationSession } from '../src/runner/local-runner';
import { SessionStore } from '../src/store/session-store';
import { renderTraceHtml } from '../src/trace/render-html';
import { buildTraceData } from '../src/trace/trace-data';

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}

  run(_request: BackendRequest): Promise<BackendResponse> {
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

const GENERATED_AT = '2026-07-26T00:00:00.000Z';

/** 에이전트가 쓰는 것과 동일한 island 추출 규약. */
function extractIsland(html: string): string {
  const match = html.match(/<script type="application\/json" id="trace-data">([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error('#trace-data island 없음');
  return match[1];
}

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

async function seedSession(theStore: SessionStore, request: string) {
  return runClarificationSession(
    {
      store: theStore,
      backend: new ScriptedBackend([clarificationResponse]),
      registry: createDefaultRegistry(),
      modelVersion: 'claude-sonnet-5',
    },
    { request, requesterLanguage: 'ko', channel: 'web' },
  );
}

describe('trace-data — 저장소 export의 조형', () => {
  it('세션·전사·슬롯·신호를 요약 지표와 함께 담고, 버전 id를 name@semver로 해석한다', async () => {
    store = SessionStore.open(':memory:');
    const result = await seedSession(store, '영업 실적 대시보드 만들어 주세요');

    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    expect(data.generatedAt).toBe(GENERATED_AT);
    expect(data.summary).toMatchObject({
      sessionCount: 1,
      statusCounts: { clarifying: 1 },
      channelCounts: { web: 1 },
      slotStateCounts: { filled: 0, unfilled: 2, promoted: 0 },
      signalTypeCounts: { clarification_round: 1 },
    });
    // 확장 신호 payload(질문 구조, #22)가 트레이스에 그대로 실린다 — 선택적 렌더링으로
    // 바뀌어도 질문 소실을 여기서 잡는다 (AGENTS.md 상시 동반 지침)
    const roundPayload = data.sessions[0]?.signals[0]?.payload as { questions?: unknown[] };
    expect(roundPayload.questions).toHaveLength(3);
    const sess = data.sessions[0];
    if (!sess) throw new Error('세션 조형 결과 없음');
    expect(sess.id).toBe(result.sessionId);
    expect(sess.utterances).toMatchObject([
      { seq: 1, authorType: 'requester' },
      { seq: 2, authorType: 'agent' }, // 게시한 질문 전사 (원칙 7) — 코어 러너 경유 (#16)
    ]);
    expect(sess.versions.model).toBe('claude-sonnet-5');
    expect(sess.versions.slotSchema).toBe('temp-required-slots@0.0.0');
    // 해석 실패 시 원문 id(UUID)가 남는다 — 성공했으면 name@semver 표기라서 @를 포함한다.
    expect(sess.versions.prompt).toContain('@');
    expect(sess.versions.threshold).toContain('@');
  });

  it('신규 신호 유형(#35 — 재개·슬롯 확인)이 요약과 세션 신호에 그대로 실린다 (AGENTS.md 동반 지침)', async () => {
    store = SessionStore.open(':memory:');
    await seedSession(store, '대시보드 요청');
    const session = store.exportSessions()[0]?.session;
    if (!session) throw new Error('시드 세션 없음');
    const axes = {
      promptVersionId: session.promptVersionId,
      modelVersion: session.modelVersion,
      thresholdVersionId: session.thresholdVersionId,
      slotSchemaVersionId: session.slotSchemaVersionId,
    };
    store.recordSignal({ sessionId: session.id, type: 'session_resumed', payload: {}, ...axes });
    store.recordSignal({
      sessionId: session.id,
      type: 'slot_confirmed',
      payload: { slotKey: 'target-user' },
      ...axes,
    });
    // 상한 승격 판정과 Phase 0 종착 (#44 — G-9·G-11)
    store.recordSignal({
      sessionId: session.id,
      type: 'promotion_judged',
      payload: { promotable: ['data-source'], blocking: [] },
      ...axes,
    });
    store.recordSignal({
      sessionId: session.id,
      type: 'session_completed',
      payload: { reason: 'all_slots_confirmed', confirmedSlotCount: 2, promotedSlotCount: 1 },
      ...axes,
    });

    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);
    expect(data.summary.signalTypeCounts).toMatchObject({
      clarification_round: 1,
      session_resumed: 1,
      slot_confirmed: 1,
      promotion_judged: 1,
      session_completed: 1,
    });
    // 판정 근거는 세션 신호에 그대로 남아야 한다 — 트레이스가 payload를 깎지 않는다
    expect(
      data.sessions[0]?.signals.find((signal) => signal.type === 'promotion_judged')?.payload,
    ).toMatchObject({ promotable: ['data-source'] });
  });

  it('빈 저장소 — 세션 0건, 평균 왕복 null', () => {
    store = SessionStore.open(':memory:');
    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);
    expect(data.summary.sessionCount).toBe(0);
    expect(data.summary.avgRoundCount).toBeNull();
    expect(data.sessions).toEqual([]);
  });
});

describe('render-html — data island 관례', () => {
  it('생성된 HTML의 #trace-data island가 원본 데이터로 파스된다', async () => {
    store = SessionStore.open(':memory:');
    await seedSession(store, '대시보드 요청');
    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    const html = renderTraceHtml(data);
    expect(JSON.parse(extractIsland(html))).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it('발화 원문의 </script> 텍스트가 island를 조기 종료시키지 않는다 (회귀 방어)', async () => {
    store = SessionStore.open(':memory:');
    const result = await seedSession(store, '요청 원문에 </script><script>alert(1)</script> 포함');
    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    const html = renderTraceHtml(data);
    const parsed = JSON.parse(extractIsland(html));
    expect(parsed.sessions[0].id).toBe(result.sessionId);
    expect(parsed.sessions[0].utterances[0].originalText).toContain('</script>');
    // 렌더러 밖 어디에도 이스케이프되지 않은 원문 script 태그가 없어야 한다.
    expect(html).not.toContain('<script>alert(1)');
  });

  it('스모크 — 문서 형태와 세션 표식', async () => {
    store = SessionStore.open(':memory:');
    const result = await seedSession(store, '대시보드 요청');
    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    const html = renderTraceHtml(data);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(GENERATED_AT);
    expect(html).toContain(result.sessionId.slice(0, 8));
  });
});
