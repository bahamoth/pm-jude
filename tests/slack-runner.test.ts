import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import type { CompletenessOutput } from '../src/prompts/completeness-v0';
import type { RequirementsOutput } from '../src/prompts/requirements-v0';
import {
  detectRequesterLanguage,
  SlackIntakeRunner,
  type SlackPostedMessage,
} from '../src/runner/slack-runner';
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

class FakeSlack {
  posted: SlackPostedMessage[] = [];

  postMessage(input: SlackPostedMessage): Promise<void> {
    this.posted.push(input);
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
  const slack = new FakeSlack();
  const backend = new ScriptedBackend(responses);
  const runner = new SlackIntakeRunner({
    store,
    backend,
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    slack,
    teamLanguage: 'ko',
    ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
  });
  return { runner, slack, backend, store };
}

const mention = {
  channel: 'C0123',
  threadTs: '1719999999.000100',
  userId: 'U777',
  text: '<@BOT> 영업 실적 대시보드 하나 만들어 주세요',
};

describe('요청자 언어 감지 초안 (F2d)', () => {
  it('한글이 섞이면 ko, 아니면 en으로 감지한다', () => {
    expect(detectRequesterLanguage('영업 실적 대시보드 만들어 주세요')).toBe('ko');
    expect(detectRequesterLanguage('Please build a sales dashboard')).toBe('en');
  });
});

describe('Slack 러너 — 멘션 인테이크', () => {
  it('멘션 한 번으로 접수 확인·질문이 스레드에 게시되고 세션이 영속된다', async () => {
    const { runner, slack, store } = makeRunner([clarificationResponse]);

    await runner.handleMention(mention);

    // 접수 확인이 질문보다 먼저, 같은 스레드에 게시된다
    expect(slack.posted.length).toBe(2);
    expect(slack.posted[0]).toMatchObject({ channel: 'C0123', threadTs: '1719999999.000100' });
    expect(slack.posted[1]?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');
    expect(slack.posted[1]?.text).toContain('모르겠어요 — 개발팀이 정해 주세요');

    const session = store.findSessionByThreadKey('slack:C0123:1719999999.000100');
    expect(session).toMatchObject({ status: 'clarifying', roundCount: 1, originChannel: 'slack' });

    const exported = store.exportSessions();
    expect(exported[0]).toMatchObject({
      utterances: [
        { authorType: 'requester', originalLanguage: 'ko' },
        { authorType: 'agent' }, // 게시한 질문도 전사에 남는다 (원칙 7)
      ],
      signals: [{ type: 'clarification_round' }],
    });
  });

  it('영어 멘션은 en으로 기록되고 접수 확인도 영어로 나간다', async () => {
    const { runner, slack, store } = makeRunner([clarificationResponse]);

    await runner.handleMention({ ...mention, text: '<@BOT> Please build a sales dashboard' });

    expect(slack.posted[0]?.text).toMatch(/[A-Za-z]/);
    expect(slack.posted[0]?.text).not.toMatch(/[가-힣]/);
    expect(store.exportSessions()[0]?.utterances[0]).toMatchObject({ originalLanguage: 'en' });
  });

  it('같은 스레드의 중복 멘션은 새 세션을 만들지 않는다', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      unrefinedCompletenessResponse,
      clarificationResponse, // 답변 취급 → 미정제 → 다음 라운드 질문
    ]);

    await runner.handleMention(mention);
    await runner.handleMention({ ...mention, text: '<@BOT> 아까 그 요청이요' }); // 답변으로 취급

    expect(store.exportSessions()).toHaveLength(1);
  });
});

describe('Slack 러너 — 스레드 답변과 2층 판정 분기', () => {
  it('정제 완료면 requirements 문서가 게시되고 세션이 documented가 된다', async () => {
    const { runner, slack, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
    ]);
    await runner.handleMention(mention);

    await runner.handleThreadReply({
      channel: 'C0123',
      threadTs: '1719999999.000100',
      userId: 'U777',
      text: '영업팀 매니저가 봅니다. 수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
    });

    const doc = slack.posted.at(-1)?.text ?? '';
    expect(doc).toContain('영업 실적을 정리해 볼 수단이 없어');
    expect(doc).toContain('오픈이슈'); // 승격 슬롯이 문서에 실린다 (F2c)
    expect(doc).toContain('data-source');

    const session = store.findSessionByThreadKey('slack:C0123:1719999999.000100');
    expect(session?.status).toBe('documented');

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
    const { runner, slack, store } = makeRunner(
      [
        clarificationResponse,
        unrefinedCompletenessResponse,
        clarificationResponse, // 2라운드 질문
      ],
      { maxRounds: 3 },
    );
    await runner.handleMention(mention);

    await runner.handleThreadReply({
      channel: 'C0123',
      threadTs: '1719999999.000100',
      userId: 'U777',
      text: '영업팀 매니저가 봅니다',
    });

    expect(slack.posted.at(-1)?.text).toContain('데이터는 어디에서 가져오면 되나요?');
    expect(store.findSessionByThreadKey('slack:C0123:1719999999.000100')).toMatchObject({
      status: 'clarifying',
      roundCount: 2,
    });
  });

  it('상한 도달 후에도 미정제면 사유 회신 후 보류(정보 부족)로 종결된다 (원칙 5)', async () => {
    const { runner, slack, store } = makeRunner(
      [clarificationResponse, unrefinedCompletenessResponse],
      { maxRounds: 1 },
    );
    await runner.handleMention(mention);

    await runner.handleThreadReply({
      channel: 'C0123',
      threadTs: '1719999999.000100',
      userId: 'U777',
      text: '잘 모르겠는데요',
    });

    const lastPost = slack.posted.at(-1)?.text ?? '';
    expect(lastPost).toContain('보류'); // 사유를 담은 회신이 종결을 앞선다
    const session = store.findSessionByThreadKey('slack:C0123:1719999999.000100');
    expect(session).toMatchObject({
      status: 'closed',
      terminalState: 'on_hold_insufficient_info',
    });
    expect(session?.closedAt).not.toBeNull();
  });

  it('세션이 없는 스레드의 답변은 무시한다', async () => {
    const { runner, slack, store } = makeRunner([]);

    await runner.handleThreadReply({
      channel: 'C0123',
      threadTs: '9999999999.000999',
      userId: 'U777',
      text: '이 스레드는 봇과 무관',
    });

    expect(slack.posted).toHaveLength(0);
    expect(store.exportSessions()).toHaveLength(0);
  });
});
