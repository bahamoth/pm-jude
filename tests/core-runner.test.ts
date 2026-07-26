import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import type { CompletenessOutput } from '../src/prompts/completeness-v0';
import type { RequirementsOutput } from '../src/prompts/requirements-v0';
import {
  detectRequesterLanguage,
  IntakeRunner,
  type ChannelPort,
  type ClarificationRoundPayload,
} from '../src/runner/core-runner';
import { SessionStore } from '../src/store/session-store';

/**
 * 코어 러너 시임 테스트 (#16) — 채널 비의존 파이프라인의 분기 케이스를 여기서 검증한다.
 * slack-runner.test.ts의 분기 케이스(승격/보류, 왕복 상한, 언어 감지)를 이관해 재구성했고,
 * Slack 테스트에는 어댑터 배선(주소 매핑·이벤트 라우팅)만 남긴다.
 */

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

/** 회신 주소로 문자열 태그를 쓰는 최소 포트 — 코어는 주소를 해석하지 않고 흘려보내야 한다. */
class FakePort implements ChannelPort<string> {
  posted: Array<{ address: string; text: string; payload?: ClarificationRoundPayload }> = [];

  post(address: string, text: string, payload?: ClarificationRoundPayload): Promise<void> {
    this.posted.push({ address, text, ...(payload ? { payload } : {}) });
    return Promise.resolve();
  }
}

const clarificationResponse = JSON.stringify({
  interpretations: ['관리자용 실적 대시보드'],
  questions: [
    {
      question: '이 대시보드는 주로 누가 보게 되나요?',
      target: { type: 'slot', slotKey: 'target-user' },
      exampleOptions: ['영업팀 매니저', '영업사원 본인'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '어떤 문제를 해결하려는 건가요?',
      target: { type: 'slot', slotKey: 'purpose' },
      exampleOptions: ['수작업 집계 제거', '실적 공유'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '데이터는 어디에서 가져오면 되나요?',
      target: { type: 'slot', slotKey: 'data-source' },
      exampleOptions: ['CRM', '사내 DB'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
  ],
});

/** 전 슬롯 해소(충족 2 + 승격 1), 임계치 이상 — 정제 완료로 이끄는 판정. */
const refinedCompletenessResponse = JSON.stringify({
  slots: [
    { slotKey: 'target-user', verdict: 'filled', rationale: '「영업팀 매니저」라고 확답' },
    { slotKey: 'purpose', verdict: 'filled', rationale: '수작업 집계 제거라고 답함' },
    {
      slotKey: 'data-source',
      verdict: 'promoted',
      rationale: '요청자가 「모르겠어요 — 개발팀이 정해 주세요」를 택함',
    },
  ],
  remainingAmbiguities: [],
  rubric: { score: 90, rationale: '핵심 슬롯 모두 해소' },
} satisfies CompletenessOutput);

/** purpose가 여전히 미충족 — 미정제로 이끄는 판정. */
const unrefinedCompletenessResponse = JSON.stringify({
  slots: [
    { slotKey: 'target-user', verdict: 'filled', rationale: '「영업팀 매니저」라고 확답' },
    { slotKey: 'purpose', verdict: 'unfilled', rationale: '어떤 문제를 푸는지 답이 없음' },
    { slotKey: 'data-source', verdict: 'unfilled', rationale: '데이터 출처 답이 없음' },
  ],
  remainingAmbiguities: ['해결하려는 문제가 불명'],
  rubric: { score: 35, rationale: '핵심이 비어 있음' },
} satisfies CompletenessOutput);

const requirementsResponse = JSON.stringify({
  problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
  users: ['영업팀 매니저'],
  scope: { inScope: ['월별 매출 추이 조회'], outOfScope: [] },
  stories: [
    {
      story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
      acceptanceCriteria: [
        {
          ears: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
          gwt: {
            given: '매출 데이터가 존재할 때',
            when: '기간을 선택하면',
            then: '월별 합계가 표시된다',
          },
        },
      ],
    },
  ],
  dataSources: [],
  openIssues: [],
} satisfies RequirementsOutput);

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function makeRunner(responses: string[], options?: { maxRounds?: number }) {
  store = SessionStore.open(':memory:');
  const port = new FakePort();
  const backend = new ScriptedBackend(responses);
  const runner = new IntakeRunner<string>({
    store,
    backend,
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    port,
    teamLanguage: 'ko',
    ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
  });
  return { runner, port, backend, store };
}

const intake = {
  address: 'reply-to:thread-1',
  threadKey: 'web:thread-1',
  channel: 'web' as const,
  authorId: 'requester-kim',
  text: '영업 실적 대시보드 하나 만들어 주세요',
};

describe('요청자 언어 감지 초안 (F2d)', () => {
  it('한글이 섞이면 ko, 아니면 en으로 감지한다', () => {
    expect(detectRequesterLanguage('영업 실적 대시보드 만들어 주세요')).toBe('ko');
    expect(detectRequesterLanguage('Please build a sales dashboard')).toBe('en');
  });
});

describe('코어 러너 — 인테이크', () => {
  it('접수 확인이 질문보다 먼저 같은 주소로 게시되고 세션이 영속된다', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    const result = await runner.handleIntake(intake);

    expect(port.posted.length).toBe(2);
    // 주소는 코어가 해석하지 않고 포트에 그대로 흘러간다 (채널 어댑터 원칙)
    expect(port.posted[0]?.address).toBe('reply-to:thread-1');
    expect(port.posted[1]?.address).toBe('reply-to:thread-1');
    expect(port.posted[1]?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');
    expect(port.posted[1]?.text).toContain('모르겠어요 — 개발팀이 정해 주세요');
    // 질문 게시에는 어댑터용 구조화 페이로드가 동봉된다 (질문별 UI·CLI 렌더링 — US-4·US-5)
    expect(port.posted[0]?.payload).toBeUndefined(); // 접수 확인은 텍스트뿐
    expect(port.posted[1]?.payload).toMatchObject({
      kind: 'clarification_questions',
      interpretations: ['관리자용 실적 대시보드'],
    });
    expect(port.posted[1]?.payload?.questions).toHaveLength(3);

    const session = store.findSessionByThreadKey('web:thread-1');
    expect(session).toMatchObject({
      id: result.sessionId,
      status: 'clarifying',
      roundCount: 1,
      originChannel: 'web',
    });

    const exported = store.exportSessions();
    expect(exported[0]).toMatchObject({
      utterances: [
        { authorType: 'requester', originalLanguage: 'ko', channel: 'web' },
        { authorType: 'agent' }, // 게시한 질문도 전사에 남는다 (원칙 7)
      ],
      signals: [{ type: 'clarification_round' }],
    });
    // 질문 구조가 신호에 영속된다 — 세션 재개 시 어댑터가 질문별 UI를 복원한다
    const round = exported[0]?.signals[0]?.payload as { questions?: unknown[] };
    expect(round.questions).toHaveLength(3);
  });

  it('명시 언어가 있으면 발화 문자 감지보다 우선한다 (웹 간이 식별)', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    // 한글 발화지만 요청자가 언어를 en으로 선택한 경우
    await runner.handleIntake({ ...intake, language: 'en' });

    expect(port.posted[0]?.text).toMatch(/[A-Za-z]/);
    expect(port.posted[0]?.text).not.toMatch(/[가-힣]/);
    expect(store.exportSessions()[0]?.utterances[0]).toMatchObject({ originalLanguage: 'en' });
  });

  it('명시 언어가 없으면 발화 문자로 감지한다', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    await runner.handleIntake({ ...intake, text: 'Please build a sales dashboard' });

    expect(port.posted[0]?.text).not.toMatch(/[가-힣]/);
    expect(store.exportSessions()[0]?.utterances[0]).toMatchObject({ originalLanguage: 'en' });
  });

  it('같은 threadKey의 재인테이크는 새 세션이 아니라 답변으로 라우팅된다', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      unrefinedCompletenessResponse,
      clarificationResponse, // 답변 취급 → 미정제 → 다음 라운드 질문
    ]);

    await runner.handleIntake(intake);
    await runner.handleIntake({ ...intake, text: '아까 그 요청이요' });

    expect(store.exportSessions()).toHaveLength(1);
  });
});

describe('코어 러너 — 답변과 2층 판정 분기', () => {
  it('정제 완료면 requirements 문서가 게시되고 세션이 documented가 된다', async () => {
    const { runner, port, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
    ]);
    await runner.handleIntake(intake);

    const result = await runner.handleReply({
      ...intake,
      text: '영업팀 매니저가 봅니다. 수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
    });

    const doc = port.posted.at(-1)?.text ?? '';
    expect(doc).toContain('영업 실적을 정리해 볼 수단이 없어');
    expect(doc).toContain('오픈이슈'); // 승격 슬롯이 문서에 실린다 (F2c)
    expect(doc).toContain('data-source');

    expect(result?.status).toBe('documented');
    expect(store.findSessionByThreadKey('web:thread-1')?.status).toBe('documented');

    // LLM 슬롯 판정이 세션 슬롯 상태로 반영된다 (승격 트리거 — US-10)
    expect(store.exportSessions()[0]?.slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotKey: 'data-source', state: 'promoted' }),
        expect.objectContaining({ slotKey: 'target-user', state: 'filled' }),
      ]),
    );
    // 판정 신호에 룰·LLM 판정이 함께 남는다 (F2 수용기준)
    const check = store
      .exportSessions()[0]
      ?.signals.find((signal) => signal.type === 'completeness_check');
    expect(check?.payload).toMatchObject({ refined: true, llmScore: 90 });
  });

  it('미정제 + 상한 미도달이면 다음 라운드 질문이 게시된다', async () => {
    const { runner, port, store } = makeRunner(
      [
        clarificationResponse,
        unrefinedCompletenessResponse,
        clarificationResponse, // 2라운드 질문
      ],
      { maxRounds: 3 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '영업팀 매니저가 봅니다' });

    expect(port.posted.at(-1)?.text).toContain('데이터는 어디에서 가져오면 되나요?');
    expect(result?.status).toBe('clarifying');
    expect(store.findSessionByThreadKey('web:thread-1')).toMatchObject({
      status: 'clarifying',
      roundCount: 2,
    });
  });

  it('상한 도달 후에도 미정제면 사유 회신 후 보류(정보 부족)로 종결된다 (원칙 5)', async () => {
    const { runner, port, store } = makeRunner(
      [clarificationResponse, unrefinedCompletenessResponse],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '잘 모르겠는데요' });

    const lastPost = port.posted.at(-1)?.text ?? '';
    expect(lastPost).toContain('보류'); // 사유를 담은 회신이 종결을 앞선다
    expect(result).toMatchObject({
      status: 'closed',
      terminalState: 'on_hold_insufficient_info',
    });
    const session = store.findSessionByThreadKey('web:thread-1');
    expect(session).toMatchObject({ status: 'closed', terminalState: 'on_hold_insufficient_info' });
    expect(session?.closedAt).not.toBeNull();
    expect(store.exportSessions()[0]?.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'session_on_hold' })]),
    );
  });

  it('보류(정보 부족) 세션은 입력으로 자동 재개된다 — 정본 전이 보류→명확화 (#30)', async () => {
    const { runner, port, store } = makeRunner(
      [
        clarificationResponse,
        unrefinedCompletenessResponse, // 1차 답변 → 상한 도달 → 보류
        unrefinedCompletenessResponse, // 재개 답변 → 미정제
        clarificationResponse, // 재개로 예산이 늘어 다음 라운드 질문
      ],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '잘 모르겠는데요' }); // → 보류 종결

    const result = await runner.handleReply({ ...intake, text: '내용을 보탤게요 — 영업팀용입니다' });

    expect(result).toMatchObject({ status: 'clarifying', terminalState: null });
    const session = store.findSessionByThreadKey('web:thread-1');
    expect(session?.closedAt).toBeNull(); // 재개는 종결 흔적을 지운다
    expect(port.posted.at(-1)?.text).toContain('데이터는 어디에서 가져오면 되나요?');
    expect(store.exportSessions()[0]?.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'session_resumed' })]),
    );
  });

  it('documented 세션의 슬롯 확인 — 맞아요는 확인 기록, 아니에요는 정정 재판정 (F3, 상한 미산입)', async () => {
    const { runner, port, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      refinedCompletenessResponse, // 정정 재판정 → 여전히 정제
      requirementsResponse, // 문서 v2
    ]);
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });
    const before = store.findSessionByThreadKey('web:thread-1');
    expect(before?.status).toBe('documented');

    // 맞아요 — 확인이 슬롯 행에 기록된다 (원칙 7 슬롯 단위 확인)
    await runner.confirmSlot(intake, 'target-user', true);
    expect(
      store.exportSessions()[0]?.slotStates.find((slot) => slot.slotKey === 'target-user'),
    ).toMatchObject({ confirmedByRequester: true });

    // 아니에요 + 정정 — 재판정 후 문서가 다시 게시되고, 왕복 상한(roundCount)은 늘지 않는다
    const roundBefore = store.findSessionByThreadKey('web:thread-1')?.roundCount;
    const outcome = await runner.confirmSlot(
      { ...intake, text: '사실 경영진 보고용이에요' },
      'purpose',
      false,
    );
    expect(outcome?.status).toBe('documented');
    expect(port.posted.at(-1)?.text).toContain('requirements v0');
    expect(store.findSessionByThreadKey('web:thread-1')?.roundCount).toBe(roundBefore);
    expect(store.exportSessions()[0]?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'slot_confirmed' }),
        expect.objectContaining({ type: 'slot_correction' }),
      ]),
    );
  });

  it('openSession/startClarification 분리 — 접수 확인이 먼저, 라운드는 나중에 (G-1)', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    const opened = await runner.openSession(intake);
    expect(opened.existing).toBe(false);
    expect(port.posted).toHaveLength(1); // 접수 확인만 — LLM 호출 전
    expect(store.getSession(opened.sessionId)?.status).toBe('intake');

    await runner.startClarification(intake);
    expect(port.posted).toHaveLength(2);
    expect(store.getSession(opened.sessionId)).toMatchObject({
      status: 'clarifying',
      roundCount: 1,
    });
  });

  it('세션이 없는 threadKey의 답변은 무시한다', async () => {
    const { runner, port, store } = makeRunner([]);

    const result = await runner.handleReply({ ...intake, threadKey: 'web:unknown' });

    expect(result).toBeNull();
    expect(port.posted).toHaveLength(0);
    expect(store.exportSessions()).toHaveLength(0);
  });

  it('보류 외의 종결 세션은 답변을 무시한다 — 재개는 보류(정보 부족) 전용 (#30)', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);
    const { sessionId } = await runner.handleIntake(intake);
    // Phase 1 종결 상태(거절 등)를 가정한 가드 회귀 방어
    store.updateSessionState(sessionId, { status: 'closed', terminalState: 'rejected' });

    const postedBefore = port.posted.length;
    const result = await runner.handleReply({ ...intake, text: '추가로요' });

    expect(result).toBeNull();
    expect(port.posted.length).toBe(postedBefore);
    // 종결 후 발화는 세션에 추가 기록되지 않는다
    expect(
      store.exportSessions()[0]?.utterances.filter((u) => u.originalText === '추가로요'),
    ).toEqual([]);
  });
});
