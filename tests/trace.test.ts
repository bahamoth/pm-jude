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
    // documented 가드의 마찰 신호 (#52)
    store.recordSignal({
      sessionId: session.id,
      type: 'reply_after_documented',
      payload: { channel: 'slack' },
      ...axes,
    });

    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);
    expect(data.summary.signalTypeCounts).toMatchObject({
      clarification_round: 1,
      session_resumed: 1,
      slot_confirmed: 1,
      promotion_judged: 1,
      session_completed: 1,
      reply_after_documented: 1,
    });
    // 판정 근거는 세션 신호에 그대로 남아야 한다 — 트레이스가 payload를 깎지 않는다
    expect(
      data.sessions[0]?.signals.find((signal) => signal.type === 'promotion_judged')?.payload,
    ).toMatchObject({ promotable: ['data-source'] });
  });

  it('첨부와 추출 결과가 요약·세션·HTML에 실린다 (F1-Attach, AGENTS.md 동반 지침)', async () => {
    store = SessionStore.open(':memory:');
    await seedSession(store, '대시보드 요청');
    const exported = store.exportSessions()[0];
    if (!exported) throw new Error('시드 세션 없음');
    const sessionId = exported.session.id;
    const utteranceId = store.listUtterances(sessionId)[0]?.id ?? '';
    const axes = {
      promptVersionId: exported.session.promptVersionId,
      modelVersion: exported.session.modelVersion,
      thresholdVersionId: exported.session.thresholdVersionId,
      slotSchemaVersionId: exported.session.slotSchemaVersionId,
    };

    const okUpload = store.stageUpload({
      filename: '기획서.txt',
      mime: 'text/plain',
      bytes: 42,
      sha256: 'a'.repeat(64),
      storageRef: `aa/${'a'.repeat(64)}`,
    });
    const failedUpload = store.stageUpload({
      filename: '스캔본.pdf',
      mime: 'application/pdf',
      bytes: 99,
      sha256: 'b'.repeat(64),
      storageRef: `bb/${'b'.repeat(64)}`,
    });
    const [ok, failed] = store.promoteUploads({
      sessionId,
      utteranceId,
      uploadIds: [okUpload, failedUpload],
    });
    if (!ok || !failed) throw new Error('첨부 승격 실패');
    store.setExtraction({
      id: ok.id,
      status: 'ok',
      extractedText: '대상 사용자: 영업팀 매니저',
      extractorVersion: 'text@0.1.0',
    });
    store.setExtraction({
      id: failed.id,
      status: 'failed',
      extractionError: '텍스트 레이어가 비어 있다 — 스캔본으로 보인다',
      extractorVersion: 'pdf-text@0.1.0',
    });
    store.setSlotState({
      sessionId,
      slotKey: 'target-user',
      state: 'filled',
      value: '영업팀 매니저',
      evidenceAttachmentId: ok.id,
    });
    store.recordSignal({
      sessionId,
      type: 'attachment_extraction_failed',
      payload: { extractorVersion: 'pdf-text@0.1.0', error: '스캔본' },
      ...axes,
    });
    // 장문 압축본 (#58 #60, ADR-0014) — 저장소 쓰기가 새로 생기면 trace가 함께 렌더링한다 (상시 지시)
    store.setCondensed({ id: ok.id, condensedText: '압축된 기획 핵심' });
    store.setUtteranceCondensed({ id: utteranceId, condensedText: '압축된 발화' });

    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    expect(data.summary.attachmentCounts).toMatchObject({ total: 2, ok: 1, failed: 1 });
    expect(data.summary.signalTypeCounts).toMatchObject({ attachment_extraction_failed: 1 });
    // 실패 사유가 깎이지 않는다 — 무엇을 못 읽었는지가 판독의 근거다 (F13)
    expect(data.sessions[0]?.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extractionStatus: 'failed',
          extractionError: '텍스트 레이어가 비어 있다 — 스캔본으로 보인다',
          extractorVersion: 'pdf-text@0.1.0',
        }),
      ]),
    );
    // 첨부 유래 슬롯은 대화 유래와 구분된다
    expect(
      data.sessions[0]?.slotStates.find((slotState) => slotState.slotKey === 'target-user')
        ?.evidenceAttachmentId,
    ).toBe(ok.id);
    // 압축 여부는 길이로 남는다 — 본문이 아니라 압축 비율이 판독 대상 (#58)
    expect(data.sessions[0]?.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extractionStatus: 'ok',
          condensedChars: '압축된 기획 핵심'.length,
        }),
      ]),
    );
    // 발화 압축도 길이만 남는다 (#60) — 압축 본문은 데이터 아일랜드에 싣지 않는다
    expect(data.sessions[0]?.utterances[0]).toMatchObject({
      seq: 1,
      condensedChars: '압축된 발화'.length,
    });
    expect(JSON.stringify(data)).not.toContain('압축된 발화');
    // 파일명은 export 단계에서 이미 빠져 있다 (요청자 이름을 담는 일이 잦다)
    expect(JSON.stringify(data)).not.toContain('기획서.txt');

    const html = renderTraceHtml(data);
    expect(html).toContain('첨부 자료');
    expect(html).toContain('pdf-text@0.1.0');
    // 압축본 길이가 데이터 아일랜드에 실리고, 렌더러가 압축·출처 열을 그린다 (#58)
    expect(html).toContain('"condensedChars": 9');
    expect(html).toContain('압축·출처');
  });

  it('requirements 문서 버전이 요약·세션·HTML에 실린다 (#53, AGENTS.md 동반 지침)', async () => {
    store = SessionStore.open(':memory:');
    await seedSession(store, '대시보드 요청');
    const exported = store.exportSessions()[0];
    if (!exported) throw new Error('시드 세션 없음');
    store.appendRequirementsDoc({
      sessionId: exported.session.id,
      version: 1,
      content: {
        problem: '영업 실적을 정리해 볼 수단이 없다',
        users: ['영업팀 매니저'],
        scope: { inScope: ['월별 매출 추이'], outOfScope: [] },
        stories: [],
        dataSources: [],
        openIssues: [],
      },
    });

    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    expect(data.summary.documentCount).toBe(1);
    expect(data.sessions[0]?.documents).toHaveLength(1);
    expect(data.sessions[0]?.documents[0]).toMatchObject({ version: 1 });
    expect(data.sessions[0]?.documents[0]?.content).toMatchObject({
      problem: '영업 실적을 정리해 볼 수단이 없다',
    });

    const html = renderTraceHtml(data);
    expect(html).toContain('requirements 문서');
  });

  it('목업 버전·어노테이션·선정이 요약·세션·HTML에 실린다 (F4 #54, AGENTS.md 동반 지침)', async () => {
    store = SessionStore.open(':memory:');
    await seedSession(store, '대시보드 요청');
    const exported = store.exportSessions()[0];
    if (!exported) throw new Error('시드 세션 없음');
    const sessionId = exported.session.id;
    const mockup = store.appendMockup({
      sessionId,
      version: 1,
      docVersion: 1,
      html: '<html><body>대시보드 목업</body></html>',
      summary: '월별 매출 추이 첫 화면',
    });
    store.addMockupAnnotations({
      sessionId,
      mockupId: mockup.id,
      comments: [{ text: '필터는 3종이면 좋겠어요', elementRef: '#filters' }],
    });
    store.updateMockup(mockup.id, { selectedTheme: 'daylight', convergence: 'approved' });

    const data = buildTraceData(store.exportSessions(), store.listVersionRegistry(), GENERATED_AT);

    expect(data.summary.mockupCounts).toMatchObject({ versions: 1, annotations: 1 });
    const traced = data.sessions[0]?.mockups;
    expect(traced).toHaveLength(1);
    // 구조 층 HTML 원문은 trace에 싣지 않는다 — 크기만 남긴다 (개발팀 전달 금지 하드 제약과 정합)
    expect(traced?.[0]).toMatchObject({
      version: 1,
      docVersion: 1,
      convergence: 'approved',
      selectedTheme: 'daylight',
      summary: '월별 매출 추이 첫 화면',
    });
    expect(JSON.stringify(traced)).not.toContain('대시보드 목업');
    expect(data.sessions[0]?.mockupAnnotations?.[0]).toMatchObject({
      mockupVersion: 1,
      text: '필터는 3종이면 좋겠어요',
    });

    const html = renderTraceHtml(data);
    expect(html).toContain('목업');
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
