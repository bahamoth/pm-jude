import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { SessionStore } from '../src/store/session-store';
import { createWebServer } from '../src/web/server';

/**
 * 웹 어댑터 HTTP 계약 smoke test (#16) — 기동 → 인테이크 POST → 답변 POST → 세션 조회 GET을
 * 실제 http 서버로 관통한다. 파이프라인 분기 검증은 코어 러너 시임(core-runner.test.ts)의 몫이고,
 * 여기서는 HTTP 계약(경로·상태 코드·응답 형태)이 끊기지 않았는지만 본다.
 */

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}

  run(_request: BackendRequest): Promise<BackendResponse> {
    const text = this.responses.shift();
    if (text === undefined) throw new Error('ScriptedBackend: 준비된 응답 없음');
    return Promise.resolve({ outputText: text, usage: { inputTokens: 100, outputTokens: 50 } });
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
});

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
});

let store: SessionStore | undefined;
let closeServer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
  store?.close();
  store = undefined;
});

async function startServer(responses: string[]): Promise<{ baseUrl: string; store: SessionStore }> {
  store = SessionStore.open(':memory:');
  const server = createWebServer({
    store,
    backend: new ScriptedBackend(responses),
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    teamLanguage: 'ko',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closeServer = () =>
    new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(port)}`, store };
}

describe('웹 어댑터 HTTP 계약 smoke', () => {
  it('인테이크 POST → 답변 POST → 세션 조회 GET이 한 세션으로 관통된다', async () => {
    const { baseUrl, store } = await startServer([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
    ]);

    // 인테이크: 간이 식별(이름·언어) + 요청 원문 → 접수 확인·질문이 회신으로 온다
    const intakeRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '김요청',
        language: 'ko',
        text: '영업 실적 대시보드 하나 만들어 주세요',
      }),
    });
    expect(intakeRes.status).toBe(201);
    const intake = (await intakeRes.json()) as {
      sessionId: string;
      status: string;
      replies: Array<{
        text: string;
        questions?: Array<{ index: number; question: string; dontKnowLabel: string }>;
      }>;
    };
    expect(intake.sessionId).toBeTruthy();
    expect(intake.status).toBe('clarifying');
    expect(intake.replies[0]?.text).toContain('접수'); // 접수 확인이 질문보다 먼저 (F1)
    expect(intake.replies[1]?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');
    // 질문별 구조가 함께 와서 「모르겠다」 1클릭 UI를 만들 수 있다 (US-5)
    expect(intake.replies[1]?.questions?.[0]).toMatchObject({
      index: 1,
      dontKnowLabel: '모르겠어요 — 개발팀이 정해 주세요',
    });

    // 답변: 정제 완료 → requirements 문서가 회신으로 온다
    const replyRes = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: '영업팀 매니저가 봅니다. 수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
      }),
    });
    expect(replyRes.status).toBe(200);
    const reply = (await replyRes.json()) as { status: string; replies: Array<{ text: string }> };
    expect(reply.status).toBe('documented');
    expect(reply.replies.at(-1)?.text).toContain('requirements v0');

    // 세션 조회: 원문 전사·슬롯 3상태·상태가 함께 온다 (US-8·9·11)
    const sessionRes = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`);
    expect(sessionRes.status).toBe(200);
    const detail = (await sessionRes.json()) as {
      session: { id: string; status: string };
      utterances: Array<{ authorType: string; originalText: string; originalLanguage: string }>;
      slotStates: Array<{ slotKey: string; state: string }>;
    };
    expect(detail.session).toMatchObject({ id: intake.sessionId, status: 'documented' });
    expect(detail.utterances[0]).toMatchObject({
      authorType: 'requester',
      originalText: '영업 실적 대시보드 하나 만들어 주세요',
      originalLanguage: 'ko',
    });
    expect(detail.slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotKey: 'data-source', state: 'promoted' }),
      ]),
    );

    // 세션은 저장소에 web 채널로 영속·버전 귀속된다 (US-12)
    expect(store.getSession(intake.sessionId)).toMatchObject({
      originChannel: 'web',
      status: 'documented',
    });
    expect(store.getSession(intake.sessionId)?.promptVersionId).toBeTruthy();
  });

  it('채팅 페이지가 서빙되고, 잘못된 요청은 4xx로 거절된다', async () => {
    const { baseUrl } = await startServer([]);

    const page = await fetch(baseUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('pm-jude');

    // 본문 없는 인테이크 → 400
    const empty = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(empty.status).toBe(400);

    // 미존재 세션 조회·답변 → 404
    const missing = await fetch(`${baseUrl}/api/sessions/no-such-id`);
    expect(missing.status).toBe(404);
    const missingReply = await fetch(`${baseUrl}/api/sessions/no-such-id/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '답변' }),
    });
    expect(missingReply.status).toBe(404);

    // 미지원 경로 → 404
    const unknown = await fetch(`${baseUrl}/api/unknown`);
    expect(unknown.status).toBe(404);
  });
});
