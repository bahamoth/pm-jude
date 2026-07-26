import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { SessionStore } from '../src/store/session-store';
import { createWebServer } from '../src/web/server';

/**
 * 웹 어댑터 HTTP 계약 smoke test (#16·#35) — 즉시 접수(F1) → 비동기 라운드 → 답변 →
 * 슬롯 확인 → 세션 조회·요약을 실제 http 서버로 관통하고, SSE 이벤트 스트림(#31)의 계약을
 * 게이트 백엔드로 결정론적으로 검증한다. 파이프라인 분기는 코어 시임의 몫.
 */

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}

  run(_request: BackendRequest): Promise<BackendResponse> {
    const text = this.responses.shift();
    if (text === undefined) throw new Error('ScriptedBackend: 준비된 응답 없음');
    return Promise.resolve({ outputText: text, usage: { inputTokens: 100, outputTokens: 50 } });
  }
}

/** 게이트가 열릴 때까지 응답을 붙잡는 백엔드 — SSE 구독을 먼저 세우는 결정론적 테스트용. */
class GatedBackend implements LlmBackend {
  private readonly gate: Promise<void>;
  open!: () => void;

  constructor(private readonly responses: string[]) {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }

  async run(_request: BackendRequest): Promise<BackendResponse> {
    await this.gate;
    const text = this.responses.shift();
    if (text === undefined) throw new Error('GatedBackend: 준비된 응답 없음');
    return { outputText: text, usage: { inputTokens: 100, outputTokens: 50 } };
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

async function startServer(backend: LlmBackend): Promise<{ baseUrl: string; store: SessionStore }> {
  store = SessionStore.open(':memory:');
  const server = createWebServer({
    store,
    backend,
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

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: 시간 초과');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('웹 어댑터 HTTP 계약 smoke', () => {
  it('접수 즉시 응답 → 비동기 라운드 → 답변 → 슬롯 확인 → 조회·요약이 관통된다', async () => {
    const { baseUrl, store } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        refinedCompletenessResponse, // 슬롯 정정 재판정
        requirementsResponse, // 문서 v2
      ]),
    );

    // 접수: 질문 생성 완료를 기다리지 않고 즉시 응답한다 (F1, G-1)
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
    const intake = await json<{ sessionId: string; status: string; ack: string }>(intakeRes);
    expect(intake.status).toBe('intake'); // 라운드는 아직 — 백그라운드
    expect(intake.ack).toContain('접수');

    // 비동기 라운드 완료를 세션 조회로 관측 (SSE 폴백 경로이기도 하다)
    const detail = await waitFor(async () => {
      const d = await json<{
        session: { status: string };
        roundBudget: number;
        latestQuestions: Array<{ index: number; dontKnowLabel: string }> | null;
        slotStates: Array<{ slotKey: string; label: string }>;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return d.session.status === 'clarifying' ? d : null;
    });
    expect(detail.roundBudget).toBeGreaterThan(0); // 마지막 라운드 예고의 근거 (G-2)
    expect(detail.latestQuestions?.[0]).toMatchObject({
      index: 1,
      dontKnowLabel: '모르겠어요 — 개발팀이 정해 주세요',
    });
    expect(detail.slotStates[0]?.label).toBeTruthy(); // 슬롯 라벨 노출 (G-2 맥락 카드)

    // 답변 → 202 접수, 판정·문서는 백그라운드 (#31) — 완료는 processing=false로 관측
    const replyRes = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '영업팀 매니저요. 수작업 집계 제거요. 데이터는 모르겠어요.' }),
    });
    expect(replyRes.status).toBe(202);
    const documented = await waitFor(async () => {
      const d = await json<{ session: { status: string }; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`),
      );
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    expect(documented.session.status).toBe('documented');

    // documented의 일반 답변은 409 — 정정은 슬롯 확인 경로만 (§6)
    const directReply = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '아무 말' }),
    });
    expect(directReply.status).toBe(409);

    // 슬롯 확인: 맞아요 → 즉시 200 (무 LLM)
    const confirmRes = await fetch(
      `${baseUrl}/api/sessions/${intake.sessionId}/slots/target-user`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    expect(confirmRes.status).toBe(200);
    const afterConfirm = await json<{
      slotStates: Array<{ slotKey: string; confirmedByRequester: boolean; value: string | null }>;
    }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
    expect(afterConfirm.slotStates.find((slot) => slot.slotKey === 'target-user')).toMatchObject({
      confirmedByRequester: true,
    });
    expect(afterConfirm.slotStates[0]?.value).toBeTruthy(); // 판정 근거가 확인 카드 텍스트

    // 아니에요 + 정정 → 202, 재판정 백그라운드 → 문서 v2 (#30 상한 미산입)
    const roundBefore = store.getSession(intake.sessionId)?.roundCount;
    const correctRes = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/slots/purpose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: false, text: '사실 경영진 보고용이에요' }),
    });
    expect(correctRes.status).toBe(202);
    await waitFor(async () => {
      const d = await json<{ session: { status: string }; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`),
      );
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    expect(store.getSession(intake.sessionId)?.roundCount).toBe(roundBefore); // 상한 미산입

    // 요약 목록 (#29 로컬 목록의 서버측 짝) — 미존재 ID는 조용히 걸러진다
    const summaries = await json<{
      sessions: Array<{
        id: string;
        status: string;
        requestText: string;
        openIssueCount: number;
      }>;
    }>(await fetch(`${baseUrl}/api/sessions?ids=${intake.sessionId},no-such-id`));
    expect(summaries.sessions).toHaveLength(1);
    expect(summaries.sessions[0]).toMatchObject({
      id: intake.sessionId,
      status: 'documented',
      requestText: '영업 실적 대시보드 하나 만들어 주세요',
      openIssueCount: 1, // data-source 승격 (§5.1 요청 카드)
    });

    expect(store.getSession(intake.sessionId)?.originChannel).toBe('web');
  });

  it('SSE 이벤트 스트림 — 구독자에게 질문 게시와 상태가 푸시된다 (#31)', async () => {
    const backend = new GatedBackend([clarificationResponse]);
    const { baseUrl } = await startServer(backend);

    const intake = await json<{ sessionId: string }>(
      await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '영업 실적 대시보드 하나 만들어 주세요', language: 'ko' }),
      }),
    );

    // 라운드가 게이트에 붙잡힌 동안 구독을 먼저 세운다 (수명 규칙: 처리 중에만 연결)
    const events = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/events`);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    if (!events.body) throw new Error('SSE 본문 없음');
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    async function readUntil(marker: string): Promise<void> {
      const start = Date.now();
      while (!buffer.includes(marker)) {
        if (Date.now() - start > 3000) throw new Error(`SSE 대기 초과: ${marker}`);
        const { value, done } = await reader.read();
        if (done) throw new Error('SSE 스트림 조기 종료');
        buffer += decoder.decode(value, { stream: true });
      }
    }

    await readUntil('event: status'); // 접속 직후 현재 상태 (processing=true라 연결 유지)
    expect(buffer).toContain('"processing":true');
    backend.open(); // 질문 생성 진행
    await readUntil('event: post'); // 질문 게시 푸시
    expect(buffer).toContain('이 대시보드는 주로 누가 보게 되나요?');
    expect(buffer).toContain('"questions"');
    await readUntil('"processing":false'); // 종료 상태 푸시 — 이후 서버가 스트림을 닫는다
    expect(buffer).toContain('"status":"clarifying"');
    await reader.cancel();

    // 수명 규칙 강제: 처리 중이 아니면 상태만 주고 서버가 즉시 닫는다 — 유휴 연결 불허
    const idle = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/events`);
    const idleBody = await idle.text(); // 서버가 닫아야 반환된다
    expect(idleBody).toContain('"processing":false');
  });

  it('안내 페이지·4xx 계약', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([clarificationResponse]));

    const page = await fetch(baseUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('pm-jude');

    const empty = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(empty.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/sessions/no-such-id`);
    expect(missing.status).toBe(404);
    const missingEvents = await fetch(`${baseUrl}/api/sessions/no-such-id/events`);
    expect(missingEvents.status).toBe(404);

    // 정정(confirmed=false)에 텍스트가 없으면 400
    const intake = await json<{ sessionId: string }>(
      await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello dashboard', language: 'en' }),
      }),
    );
    const badCorrection = await fetch(
      `${baseUrl}/api/sessions/${intake.sessionId}/slots/target-user`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: false }),
      },
    );
    expect(badCorrection.status).toBe(400);

    const unknown = await fetch(`${baseUrl}/api/unknown`);
    expect(unknown.status).toBe(404);
  });
});
