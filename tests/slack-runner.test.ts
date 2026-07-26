import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { SlackIntakeRunner, type SlackPostedMessage } from '../src/runner/slack-runner';
import { SessionStore } from '../src/store/session-store';

/**
 * Slack 어댑터 배선 테스트 (#8, #16) — 이벤트 → 코어 이벤트 매핑과 회신 주소 → SlackPort
 * 매핑만 검증한다. 파이프라인 분기 케이스(승격/보류, 왕복 상한, 언어 감지)는 코어 러너
 * 시임(core-runner.test.ts)으로 이관됐다.
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

/** purpose가 여전히 미충족 — 미정제로 이끄는 판정. */
const unrefinedCompletenessResponse = JSON.stringify({
  slots: [
    { slotKey: 'target-user', verdict: 'filled', rationale: '「영업팀 매니저」라고 확답' },
    { slotKey: 'purpose', verdict: 'unfilled', rationale: '어떤 문제를 푸는지 답이 없음' },
    { slotKey: 'data-source', verdict: 'unfilled', rationale: '데이터 출처 답이 없음' },
  ],
  remainingAmbiguities: ['해결하려는 문제가 불명'],
  rubric: { score: 35, rationale: '핵심이 비어 있음' },
});

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function makeRunner(responses: string[]) {
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
  });
  return { runner, slack, backend, store };
}

const mention = {
  channel: 'C0123',
  threadTs: '1719999999.000100',
  userId: 'U777',
  text: '<@BOT> 영업 실적 대시보드 하나 만들어 주세요',
};

describe('Slack 어댑터 배선', () => {
  it('멘션이 코어를 관통해 접수 확인·질문이 같은 스레드 주소로 게시되고 slack threadKey로 영속된다', async () => {
    const { runner, slack, store } = makeRunner([clarificationResponse]);

    await runner.handleMention(mention);

    // 회신 주소 매핑: 코어의 주소가 SlackPort의 channel/thread_ts로 변환된다
    expect(slack.posted.length).toBe(2);
    expect(slack.posted[0]).toMatchObject({ channel: 'C0123', threadTs: '1719999999.000100' });
    expect(slack.posted[1]?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');

    // threadKey 매핑: 세션이 slack:<channel>:<thread_ts>로 영속된다
    const session = store.findSessionByThreadKey('slack:C0123:1719999999.000100');
    expect(session).toMatchObject({ status: 'clarifying', roundCount: 1, originChannel: 'slack' });
    expect(store.exportSessions()[0]?.utterances[0]).toMatchObject({
      authorType: 'requester',
      channel: 'slack',
      originalLanguage: 'ko',
    });
  });

  it('같은 스레드의 재멘션은 새 세션이 아니라 답변으로 라우팅된다', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      unrefinedCompletenessResponse,
      clarificationResponse, // 답변 취급 → 미정제 → 다음 라운드 질문
    ]);

    await runner.handleMention(mention);
    await runner.handleMention({ ...mention, text: '<@BOT> 아까 그 요청이요' });

    expect(store.exportSessions()).toHaveLength(1);
  });

  it('스레드 답변이 코어 답변 처리로 배선된다', async () => {
    const { runner, slack, store } = makeRunner([
      clarificationResponse,
      unrefinedCompletenessResponse,
      clarificationResponse, // 2라운드 질문
    ]);
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
});
