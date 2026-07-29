import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtractorRegistry } from '../src/extract/registry';
import { textExtractor } from '../src/extract/text';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { DEFAULT_ATTACHMENT_LIMITS } from '../src/runner/core-runner';
import { nonUiClassificationResponse, slot } from './slot-fixture';
import { AttachmentStore } from '../src/store/attachment-store';
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
  options?: {
    maxRounds?: number;
    attachments?: boolean;
    maxBytesPerFile?: number;
    maxUtteranceChars?: number;
  },
): Promise<{ baseUrl: string; store: SessionStore }> {
  store = SessionStore.open(':memory:');
  // 첨부를 켜는 구성은 텍스트 추출기만 등록한다 — 어댑터 계약 검증에 이미지 호출은 불필요
  const extractors = new ExtractorRegistry();
  extractors.register(textExtractor);
  const server = createWebServer({
    store,
    backend,
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    teamLanguage: 'ko',
    ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options?.maxUtteranceChars !== undefined
      ? { maxUtteranceChars: options.maxUtteranceChars }
      : {}),
    ...(options?.attachments
      ? {
          attachmentStore: new AttachmentStore(mkdtempSync(join(tmpdir(), 'pm-jude-web-attach-'))),
          createExtractors: () => extractors,
          ...(options.maxBytesPerFile !== undefined
            ? { limits: { ...DEFAULT_ATTACHMENT_LIMITS, maxBytesPerFile: options.maxBytesPerFile } }
            : {}),
        }
      : {}),
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
        nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
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
        document: { version: number; content: { problem: string; users: string[] } } | null;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    expect(documented.session.status).toBe('documented');
    expect(documented.documentVersion).toBe(1); // 문서 vN 노출 (G-11)
    // 문서 구조체가 API로 그대로 내려온다 — 화면은 게시 텍스트 역파싱이 아니라 이걸 쓴다 (#53)
    expect(documented.document?.version).toBe(1);
    expect(documented.document?.content.problem).toBeTruthy();
    expect(documented.document?.content.users.length).toBeGreaterThan(0);

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
        document: { version: number } | null;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    expect(store.getSession(intake.sessionId)?.roundCount).toBe(roundBefore); // 상한 미산입
    expect(regenerated.documentVersion).toBe(2); // 정정 재생성은 v2 (G-11)
    expect(regenerated.document?.version).toBe(2); // 최신 버전 구조체가 내려온다 (#53)

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

describe('웹 어댑터 — 자료 첨부 (F1-Attach, ADR-0011)', () => {
  /** 업로드 요청 하나 — multipart 없이 raw body + 헤더다 (결정 10). */
  function upload(baseUrl: string, filename: string, text: string, mime = 'text/plain') {
    return fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': mime, 'x-filename': encodeURIComponent(filename) },
      body: Buffer.from(text, 'utf8'),
    });
  }

  it('업로드 → 참조 → 추출이 관통하고, 첨부가 세션 조회에 실린다', async () => {
    const { baseUrl } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      ]),
      { attachments: true },
    );

    const uploaded = await json<{ uploadId: string; filename: string; bytes: number }>(
      await upload(baseUrl, '기획서.txt', '대상 사용자: 영업팀 매니저'),
    );
    expect(uploaded.filename).toBe('기획서.txt');

    const intake = await json<{ sessionId: string }>(
      await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: '영업 실적 대시보드 하나 만들어 주세요',
          language: 'ko',
          uploadIds: [uploaded.uploadId],
        }),
      }),
    );

    const detail = await waitFor(async () => {
      const d = await json<{
        processing: boolean;
        attachments: Array<{ id: string; filename: string; extractionStatus: string }>;
      }>(await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`));
      return !d.processing && d.attachments[0]?.extractionStatus !== 'pending' ? d : null;
    });
    expect(detail.attachments).toEqual([
      expect.objectContaining({ filename: '기획서.txt', extractionStatus: 'ok' }),
    ]);
  });

  it('업로드 거부는 사유와 함께 즉시 온다 — 제출한 뒤에 알게 하지 않는다 (P-U1)', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([]), {
      attachments: true,
      maxBytesPerFile: 32,
    });

    const unsupported = await upload(baseUrl, 'a.zip', 'x', 'application/zip');
    expect(unsupported.status).toBe(400);
    expect(await json<{ code: string; error: string }>(unsupported)).toMatchObject({
      code: 'upload_rejected',
    });

    const tooBig = await upload(baseUrl, 'big.txt', 'x'.repeat(100));
    expect(tooBig.status).toBe(400);

    const empty = await upload(baseUrl, 'empty.txt', '');
    expect(empty.status).toBe(400);

    const noName = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x',
    });
    expect(noName.status).toBe(400);
  });

  it('첨부를 받지 않는 구성에서는 업로드 경로가 열리지 않는다', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([]));

    expect((await upload(baseUrl, 'a.txt', 'x')).status).toBe(404);
  });

  it('원본 다운로드는 인라인 렌더를 막고 세션 스코프를 지킨다 (결정 13)', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([clarificationResponse]), {
      attachments: true,
    });
    const uploaded = await json<{ uploadId: string }>(
      await upload(baseUrl, '기획서.txt', '본문 내용'),
    );
    const intake = await json<{ sessionId: string }>(
      await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '대시보드 만들어 주세요', uploadIds: [uploaded.uploadId] }),
      }),
    );
    const detail = await waitFor(async () => {
      const d = await json<{ processing: boolean; attachments: Array<{ id: string }> }>(
        await fetch(`${baseUrl}/api/sessions/${intake.sessionId}`),
      );
      return !d.processing && d.attachments.length > 0 ? d : null;
    });
    const attachmentId = detail.attachments[0]?.id ?? '';

    const res = await fetch(
      `${baseUrl}/api/sessions/${intake.sessionId}/attachments/${attachmentId}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain('attachment;');
    expect(await res.text()).toBe('본문 내용');

    // 다른 세션 경로로는 같은 첨부를 꺼낼 수 없다
    const other = await json<{ sessionId: string }>(
      await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '다른 요청입니다' }),
      }),
    );
    const cross = await fetch(
      `${baseUrl}/api/sessions/${other.sessionId}/attachments/${attachmentId}`,
    );
    expect(cross.status).toBe(404);
  });

  it('uploadIds가 문자열 배열이 아니면 거부한다', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([]), { attachments: true });

    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '요청입니다', uploadIds: 'not-an-array' }),
    });

    expect(res.status).toBe(400);
  });

  it('세션 없는 화면도 업로드 정책을 물을 수 있다 — 인테이크 폼이 미리 고지한다', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([]), { attachments: true });

    const policy = await json<{ enabled: boolean; supportedMimes: string[] }>(
      await fetch(`${baseUrl}/api/uploads`),
    );

    expect(policy.enabled).toBe(true);
    expect(policy.supportedMimes).toContain('text/plain');

    const { baseUrl: plain } = await startServer(new ScriptedBackend([]));
    expect(await json<{ enabled: boolean }>(await fetch(`${plain}/api/uploads`))).toEqual({
      enabled: false,
    });
  });

  it('세션 조회가 업로드 가능 여부와 상한을 알려준다 — 화면이 미리 고지할 근거', async () => {
    const { baseUrl } = await startServer(new ScriptedBackend([clarificationResponse]), {
      attachments: true,
    });
    const sessionId = await openClarifyingSession(baseUrl);

    const detail = await json<{
      uploads: { enabled: boolean; supportedMimes?: string[]; maxPerSession?: number };
    }>(await fetch(`${baseUrl}/api/sessions/${sessionId}`));

    expect(detail.uploads.enabled).toBe(true);
    expect(detail.uploads.supportedMimes).toContain('text/plain');
    expect(detail.uploads.maxPerSession).toBe(DEFAULT_ATTACHMENT_LIMITS.maxPerSession);
  });
});

describe('웹 어댑터 — 목업 반복·디자인 시스템 선정 (F4, #54)', () => {
  const uiYesResponse = JSON.stringify({
    isUiRequest: true,
    rationale: '대시보드 화면 신설 — UI 변화를 수반한다',
  });

  const mockupResponse = (marker: string) =>
    JSON.stringify({
      html: `<html><body><h1>영업 실적 대시보드</h1><p>${marker}</p></body></html>`,
      summary: marker,
    });

  const backInjectedResponse = JSON.stringify({
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

  /** 인테이크 → 답변 → 목업 v1 게시(mockup 상태)까지 — 목업 계약 테스트의 공통 준비. */
  async function openMockupSession(baseUrl: string): Promise<string> {
    const sessionId = await openClarifyingSession(baseUrl);
    const roundId = await roundIdOf(baseUrl, sessionId);
    await postReply(baseUrl, sessionId, '영업팀 매니저요. 수작업 집계를 없애고 싶어요.', roundId);
    await waitFor(async () => {
      const d = await json<{ session: { status: string }; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}`),
      );
      return !d.processing && d.session.status === 'mockup' ? d : null;
    });
    return sessionId;
  }

  it('목업 서빙 → 어노테이션 → 테마 선정 → 승인·역주입이 HTTP로 관통된다', async () => {
    const { baseUrl, store } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        uiYesResponse,
        mockupResponse('v1'),
        mockupResponse('v2 — 필터 반영'),
        backInjectedResponse,
      ]),
    );
    const sessionId = await openMockupSession(baseUrl);

    // 세션 조회에 목업 요약이 실린다 — 화면이 목업 패널을 열 근거
    const detail = await json<{
      mockup: { latestVersion: number; convergence: string } | null;
    }>(await fetch(`${baseUrl}/api/sessions/${sessionId}`));
    expect(detail.mockup?.latestVersion).toBe(1);

    // 목업 상태 조회 — 버전·예산·테마 후보·어노테이션
    const state = await json<{
      latestVersion: number;
      iterationBudget: number;
      themes: Array<{ id: string; name: string }>;
      convergence: string;
    }>(await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup`));
    expect(state.latestVersion).toBe(1);
    expect(state.themes.length).toBeGreaterThanOrEqual(2);
    expect(state.convergence).toBe('iterating');

    // 목업 HTML 서빙 — 샌드박스 CSP + 워터마크 상시 + 그레이스케일 토큰 (하드 제약)
    const served = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockups/1`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(served.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
    const html = await served.text();
    expect(html).toContain('요구사항 확인용 목업');
    expect(html).toContain('--pj-bg: #f5f5f5'); // 테마 선정 전 — 그레이스케일 기본값

    // 어노테이션 → 202 → 백그라운드 재생성으로 v2
    const annotated = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mockupVersion: 1,
        comments: [{ text: '필터는 기간·팀·상태 3종이면 좋겠어요', elementRef: '#filters' }],
      }),
    });
    expect(annotated.status).toBe(202);
    await waitFor(async () => {
      const s = await json<{ latestVersion: number; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup`),
      );
      return !s.processing && s.latestVersion === 2 ? s : null;
    });

    // 테마 선정(동기) → 테마 미리보기 서빙에 토큰이 입혀진다
    const themed = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/theme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeId: 'daylight' }),
    });
    expect(themed.status).toBe(200);
    const preview = await (await fetch(`${baseUrl}/api/sessions/${sessionId}/mockups/2`)).text();
    expect(preview).toContain('--pj-accent: #2f6fed'); // daylight 토큰 — 선정 결과가 기본 서빙에 반영

    // 승인 → 202 → 역주입 문서 v2 + 목업 approved + 세션 documented
    const approved = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(approved.status).toBe(202);
    await waitFor(async () => {
      const d = await json<{ session: { status: string }; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}`),
      );
      return !d.processing && d.session.status === 'documented' ? d : null;
    });
    const docs = store.listRequirementsDocs(sessionId);
    expect(docs.length).toBe(2);
    expect(docs[1]!.backInjectedFrom).toBe(store.latestMockup(sessionId)!.id);
    expect(store.latestMockup(sessionId)?.convergence).toBe('approved');
  });

  it('스테일 목업 버전의 어노테이션은 409 — 다른 탭이 이미 다음 판으로 넘긴 경우', async () => {
    const { baseUrl } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        uiYesResponse,
        mockupResponse('v1'),
        mockupResponse('v2'),
      ]),
    );
    const sessionId = await openMockupSession(baseUrl);
    await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mockupVersion: 1, comments: [{ text: '표를 카드로' }] }),
    });
    await waitFor(async () => {
      const s = await json<{ latestVersion: number; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup`),
      );
      return !s.processing && s.latestVersion === 2 ? s : null;
    });

    const stale = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mockupVersion: 1, comments: [{ text: '이전 판에 남긴 코멘트' }] }),
    });
    expect(stale.status).toBe(409);
    expect((await json<{ code: string }>(stale)).code).toBe('stale_mockup');
  });

  it('목업이 없는 세션의 목업 경로는 404 — 비 UI 요청', async () => {
    const { baseUrl } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        nonUiClassificationResponse,
      ]),
    );
    const sessionId = await openClarifyingSession(baseUrl);
    const roundId = await roundIdOf(baseUrl, sessionId);
    await postReply(baseUrl, sessionId, '영업팀 매니저요. 수작업 집계 제거요.', roundId);
    await waitFor(async () => {
      const d = await json<{ session: { status: string }; processing: boolean }>(
        await fetch(`${baseUrl}/api/sessions/${sessionId}`),
      );
      return !d.processing && d.session.status === 'documented' ? d : null;
    });

    expect((await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/sessions/${sessionId}/mockups/1`)).status).toBe(404);
  });

  it('후보 밖 테마 id는 400 — 기록 없이 거부된다', async () => {
    const { baseUrl } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        uiYesResponse,
        mockupResponse('v1'),
      ]),
    );
    const sessionId = await openMockupSession(baseUrl);

    const rejected = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/theme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeId: 'no-such-theme' }),
    });
    expect(rejected.status).toBe(400);
  });

  it('테마 결정 전의 승인은 409 — 시각 방향 없이 역주입하지 않는다', async () => {
    const { baseUrl } = await startServer(
      new ScriptedBackend([
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        uiYesResponse,
        mockupResponse('v1'),
      ]),
    );
    const sessionId = await openMockupSession(baseUrl);

    const rejected = await fetch(`${baseUrl}/api/sessions/${sessionId}/mockup/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(rejected.status).toBe(409);
    expect((await json<{ code: string }>(rejected)).code).toBe('theme_required');
  });
});

describe('웹 어댑터 — 발화 길이 상한 (#58, ADR-0014)', () => {
  it('상한 초과 인테이크는 400과 사유·대안 안내로 거부된다', async () => {
    const { baseUrl, store } = await startServer(new ScriptedBackend([]), {
      maxUtteranceChars: 100,
    });

    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '가'.repeat(101), language: 'ko' }),
    });

    expect(res.status).toBe(400);
    const body = await json<{ code: string; error: string }>(res);
    expect(body.code).toBe('utterance_rejected');
    expect(body.error).toMatch(/첨부|링크/);
    expect(store.exportSessions()).toHaveLength(0); // 세션 자체가 만들어지지 않는다
  });
});
