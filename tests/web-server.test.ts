import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { slot } from './slot-fixture';
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
    slot('target-user', 'filled', '「영업팀 매니저」라고 확답'),
    slot('purpose', 'filled', '수작업 집계 제거라고 답함'),
    slot('data-source', 'promoted', '요청자가 「모르겠어요 — 개발팀이 정해 주세요」를 택함'),
  ],
  remainingAmbiguities: [],
  rubric: { score: 90, rationale: '핵심 슬롯 모두 해소' },
});

const unrefinedCompletenessResponse = JSON.stringify({
  slots: [
    slot('target-user', 'filled', '「영업팀 매니저」라고 확답'),
    slot('purpose', 'unfilled', '어떤 문제를 푸는지 답이 없음'),
    slot('data-source', 'unfilled', '데이터 출처 답이 없음'),
  ],
  remainingAmbiguities: ['해결하려는 문제가 불명'],
  rubric: { score: 35, rationale: '핵심이 비어 있음' },
});

/** 승격 불가 판정 — 상한 도달 세션을 보류로 종결시킨다. */
const blockingPromotionResponse = JSON.stringify({
  decisions: [
    {
      slotKey: 'purpose',
      promotable: false,
      rationale: '무엇을 해결하려는지가 대화 어디에도 없다',
    },
    {
      slotKey: 'data-source',
      promotable: false,
      rationale: '요청 자체가 판별 불가라 담당자도 정할 수 없다',
    },
  ],
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

async function startServer(
  backend: LlmBackend,
  options?: { maxRounds?: number },
): Promise<{ baseUrl: string; store: SessionStore }> {
  store = SessionStore.open(':memory:');
  const server = createWebServer({
    store,
    backend,
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    teamLanguage: 'ko',
    ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
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

/** 접수 → 첫 라운드 게시 완료까지 — 라운드 계약 테스트의 공통 준비. */
async function openClarifyingSession(baseUrl: string): Promise<string> {
  const intake = await json<{ sessionId: string }>(
    await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '영업 실적 대시보드 하나 만들어 주세요', language: 'ko' }),
    }),
  );
  await waitFor(async () => {
    const d = await json<{ session: { status: string }; processing: boolean }>(
      await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`),
    );
    return !d.processing && d.session.status === 'clarifying' ? d : null;
  });
  return intake.sessionId;
}

async function roundIdOf(baseUrl: string, sessionId: string): Promise<string | null> {
  const detail = await json<{ roundId: string | null }>(
    await fetch(`${baseUrl}/api/sessions/${sessionId}`),
  );
  return detail.roundId;
}

function postReply(
  baseUrl: string,
  sessionId: string,
  text: string,
  roundId?: string | null,
): Promise<Response> {
  return fetch(`${baseUrl}/api/sessions/${sessionId}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...(roundId ? { roundId } : {}) }),
  });
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
        roundId: string | null;
        documentVersion: number;
        latestQuestions: Array<{ index: number; dontKnowLabel: string }> | null;
        slotStates: Array<{ slotKey: string; label: string }>;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return d.session.status === 'clarifying' ? d : null;
    });
    expect(detail.roundBudget).toBeGreaterThan(0); // 마지막 라운드 예고의 근거 (G-2)
    expect(detail.roundId).toBeTruthy(); // 답변이 응답할 라운드 식별자 (G-10)
    expect(detail.documentVersion).toBe(0); // 아직 문서 없음 (G-11)
    expect(detail.latestQuestions?.[0]).toMatchObject({
      index: 1,
      dontKnowLabel: '모르겠어요 — 개발팀이 정해 주세요',
    });
    expect(detail.slotStates[0]?.label).toBeTruthy(); // 슬롯 라벨 노출 (G-2 맥락 카드)

    // 답변 → 202 접수, 판정·문서는 백그라운드 (#31) — 완료는 processing=false로 관측
    const replyRes = await fetch(`${baseUrl}/api/sessions/${intake.sessionId}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: '영업팀 매니저요. 수작업 집계 제거요. 데이터는 모르겠어요.',
        roundId: detail.roundId,
      }),
    });
    expect(replyRes.status).toBe(202);
    const documented = await waitFor(async () => {
      const d = await json<{
        session: { status: string };
        processing: boolean;
        documentVersion: number;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    expect(documented.session.status).toBe('documented');
    expect(documented.documentVersion).toBe(1); // 문서 vN 노출 (G-11)

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
    const regenerated = await waitFor(async () => {
      const d = await json<{
        session: { status: string };
        processing: boolean;
        documentVersion: number;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    expect(store.getSession(intake.sessionId)?.roundCount).toBe(roundBefore); // 상한 미산입
    expect(regenerated.documentVersion).toBe(2); // 정정 재생성은 v2 (G-11)

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

  it('스테일 라운드 제출은 거부되고 최신 라운드만 접수된다 (G-10, #28 S-3)', async () => {
    const { baseUrl } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        unrefinedCompletenessResponse, // 1라운드 답변 → 미정제
        clarificationResponse, // 2라운드 질문
      ]),
    );
    const sessionId = await openClarifyingSession(baseUrl);
    const first = await roundIdOf(baseUrl, sessionId);

    // roundId 없는 제출은 계약 위반 — 어느 질문에 답한 것인지 알 수 없다
    const noRound = await postReply(baseUrl, sessionId, '영업팀 매니저요');
    expect(noRound.status).toBe(400);

    const accepted = await postReply(baseUrl, sessionId, '영업팀 매니저요', first);
    expect(accepted.status).toBe(202);
    const second = await waitFor(async () => {
      const id = await roundIdOf(baseUrl, sessionId);
      return id !== null && id !== first ? id : null;
    });

    // 다른 탭이 1라운드 질문에 답한 경우 — 최신 질문의 답으로 오결합되지 않게 거부한다
    const stale = await postReply(baseUrl, sessionId, '아까 그 질문 답이요', first);
    expect(stale.status).toBe(409);
    expect(await json<{ code: string }>(stale)).toMatchObject({ code: 'stale_round' });
    expect(second).not.toBe(first);
  });

  it('이미 답을 받은 라운드의 재제출은 종결된 세션에서도 거부된다 (G-10, #28 S-3)', async () => {
    const { baseUrl, store } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        unrefinedCompletenessResponse,
        blockingPromotionResponse, // 상한 도달 → 승격 불가 → 보류 종결
      ]),
      { maxRounds: 1 },
    );
    const sessionId = await openClarifyingSession(baseUrl);
    const roundId = await roundIdOf(baseUrl, sessionId);

    expect((await postReply(baseUrl, sessionId, '잘 모르겠는데요', roundId)).status).toBe(202);
    await waitFor(async () => {
      const d = await json<{ session: { terminalState: string | null }; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}`),
      );
      return !d.processing && d.session.terminalState === 'on_hold_insufficient_info' ? d : null;
    });

    // 다른 탭이 같은 라운드 질문에 답한 경우 — 재개 입력으로 오인해 예산을 다시 주면 안 된다
    const stale = await postReply(baseUrl, sessionId, '늦게 도착한 답', roundId);
    expect(stale.status).toBe(409);
    expect(await json<{ code: string }>(stale)).toMatchObject({ code: 'stale_round' });
    expect(
      store.listUtterances(sessionId).filter((u) => u.authorType === 'requester'),
    ).toHaveLength(2);

    // 보류 화면의 재개 입력은 답할 라운드가 없으므로 그대로 접수된다 (#30)
    const resume = await postReply(baseUrl, sessionId, '내용을 보탤게요 — 영업팀용입니다');
    expect(resume.status).toBe(202);
  });

  it('실패한 라운드의 재시도는 멱등이다 — 발화·예산을 다시 먹지 않는다 (G-10, #28 S-4)', async () => {
    const script = [clarificationResponse]; // 판정 응답이 없어 답변 라운드가 죽는다
    const { baseUrl, store } = await startServer(new ScriptedBackend(script));
    const sessionId = await openClarifyingSession(baseUrl);
    const roundId = await roundIdOf(baseUrl, sessionId);

    expect((await postReply(baseUrl, sessionId, '영업팀 매니저요', roundId)).status).toBe(202);
    await waitFor(async () => {
      const d = await json<{ processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}`),
      );
      return d.processing ? null : true;
    });
    const roundCountAfterFailure = store.getSession(sessionId)?.roundCount;
    const utterancesAfterFailure = store.listUtterances(sessionId).length;

    script.push(unrefinedCompletenessResponse, clarificationResponse);
    const retry = await fetch(`${baseUrl}/api/sessions/${sessionId}/rounds`, { method: 'POST' });
    expect(retry.status).toBe(202);
    await waitFor(async () => {
      const id = await roundIdOf(baseUrl, sessionId);
      return id !== null && id !== roundId ? id : null;
    });

    // 재시도는 죽은 라운드의 몫만 소모하고 요청자 발화를 다시 적지 않는다
    expect(store.getSession(sessionId)?.roundCount).toBe((roundCountAfterFailure ?? 0) + 1);
    expect(
      store.listUtterances(sessionId).filter((u) => u.authorType === 'requester'),
    ).toHaveLength(2);
    expect(store.listUtterances(sessionId).length).toBe(utterancesAfterFailure + 1); // 질문 1건만 추가

    // 미완 라운드가 없으면 재시도는 거부된다 — 재시도가 새 라운드를 만들지 않는다
    const again = await fetch(`${baseUrl}/api/sessions/${sessionId}/rounds`, { method: 'POST' });
    expect(again.status).toBe(409);
  });

  it('로컬 허브 (#36) — 보드·트레이스·문서가 호스팅되고 화이트리스트 밖은 닫힌다', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([]));

    const hub = await fetch(baseUrl);
    expect(hub.status).toBe(200);
    expect(await hub.text()).toContain('이슈 보드');

    const board = await fetch(`${baseUrl}/board`);
    expect(await board.text()).toContain('issues-data'); // 보드 data island

    const trace = await fetch(`${baseUrl}/trace`);
    expect(await trace.text()).toContain('trace-data'); // 실시간 렌더링된 트레이스

    const prd = await fetch(`${baseUrl}/repo/PRD.md`);
    expect(await prd.text()).toContain('marked.min.js'); // md 뷰어 셸

    const adr = await fetch(`${baseUrl}/repo/docs/adr/`);
    expect(await adr.text()).toContain('0001'); // 디렉터리 목록

    // 화이트리스트 밖·경로 이탈은 404 — 코드·데이터·환경 파일은 열지 않는다
    expect((await fetch(`${baseUrl}/repo/src/web/server.ts`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/repo/package.json`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/repo/docs/%2e%2e/package.json`)).status).toBe(404);
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
