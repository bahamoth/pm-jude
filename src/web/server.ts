import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LlmBackend } from '../gateway/backend';
import type { UsageLogger } from '../gateway/gateway';
import { clarificationOutputSchema } from '../prompts/clarification-v0';
import type { PromptRegistry } from '../prompts/registry';
import {
  IntakeRunner,
  TEMP_REQUIRED_SLOTS,
  type ChannelPort,
  type ClarificationRoundPayload,
} from '../runner/core-runner';
import type { SessionStore } from '../store/session-store';

/**
 * 웹 채널 어댑터 (#16·#35, ADR-0007/0008) — Node 내장 http 로컬 단일 프로세스 서버.
 * 접수는 즉시 응답하고(F1), 질문·판정·문서 게시는 세션 이벤트 스트림(SSE)으로 푸시한다(#31).
 * 회신 주소는 {sessionId, collector}: 포트 게시가 SSE 구독자에게 브로드캐스트되고,
 * 동기 응답이 필요한 경로는 수집기로도 받는다. 로직은 코어 러너 몫 — 여기는 HTTP 배선만.
 */

export interface WebServerDeps {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  usageLogger?: UsageLogger;
  teamLanguage?: string;
  maxRounds?: number;
}

/** 질문별 「모르겠다」 1클릭 버튼(US-5) 렌더링에 필요한 최소 구조 — 내부 슬롯 매핑은 내보내지 않는다. */
interface ReplyQuestion {
  index: number;
  question: string;
  exampleOptions: string[];
  dontKnowLabel: string;
}

interface Reply {
  text: string;
  questions?: ReplyQuestion[];
}

interface WebAddress {
  sessionId?: string;
  collector?: Reply[];
}

function toReplyQuestions(payload: ClarificationRoundPayload): ReplyQuestion[] {
  return payload.questions.map((question, i) => ({
    index: i + 1,
    question: question.question,
    exampleOptions: [...question.exampleOptions],
    dontKnowLabel: question.dontKnowPath.label,
  }));
}

/**
 * clarification_round 신호에 영속된 질문 구조를 복원한다 (세션 재개용 — DB 값이라 런타임 검증).
 * 검증은 명확화 출력 zod 스키마를 재사용한다. 어긋나면 null — 어댑터는 자유 입력으로 강등한다.
 */
function parseStoredQuestions(payload: unknown): ReplyQuestion[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { questions } = payload as { questions?: unknown };
  const parsed = clarificationOutputSchema.shape.questions.safeParse(questions);
  if (!parsed.success || parsed.data.length === 0) return null;
  return parsed.data.map((question, i) => ({
    index: i + 1,
    question: question.question,
    exampleOptions: [...question.exampleOptions],
    dontKnowLabel: question.dontKnowPath.label,
  }));
}

const MAX_BODY_BYTES = 1_000_000;
const HEARTBEAT_MS = 15_000;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequest('요청 본문이 너무 크다'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('객체가 아님');
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new BadRequest('본문은 JSON 객체여야 한다'));
      }
    });
    req.on('error', reject);
  });
}

class BadRequest extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function parseIntakeBody(body: Record<string, unknown>): {
  text: string;
  name?: string;
  language?: 'ko' | 'en';
} {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new BadRequest('text는 비어 있지 않은 문자열이어야 한다');
  if (body.language !== undefined && body.language !== 'ko' && body.language !== 'en') {
    throw new BadRequest('language는 ko 또는 en이어야 한다');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  return {
    text,
    ...(name ? { name } : {}),
    ...(body.language !== undefined ? { language: body.language as 'ko' | 'en' } : {}),
  };
}

export function createWebServer(deps: WebServerDeps): Server {
  const { store } = deps;

  // 세션 이벤트 스트림 (#31 SSE) — 구독자와 진행 중 백그라운드 라운드의 서버 내 상태
  const subscribers = new Map<string, Set<ServerResponse>>();
  const inFlight = new Set<string>();

  function sseSend(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(sessionId: string, event: string, data: unknown): void {
    for (const res of subscribers.get(sessionId) ?? []) sseSend(res, event, data);
  }

  function statusOf(sessionId: string): Record<string, unknown> | null {
    const session = store.getSession(sessionId);
    if (!session) return null;
    return {
      sessionId,
      status: session.status,
      terminalState: session.terminalState,
      roundCount: session.roundCount,
      roundBudget: runner.roundBudgetOf(sessionId),
    };
  }

  function broadcastStatus(sessionId: string): void {
    const status = statusOf(sessionId);
    if (status) broadcast(sessionId, 'status', status);
  }

  const port: ChannelPort<WebAddress> = {
    post(address, text, payload) {
      const reply: Reply = {
        text,
        ...(payload?.kind === 'clarification_questions'
          ? { questions: toReplyQuestions(payload) }
          : {}),
      };
      address.collector?.push(reply);
      if (address.sessionId) broadcast(address.sessionId, 'post', reply);
      return Promise.resolve();
    },
  };
  const runner = new IntakeRunner<WebAddress>({ ...deps, port });

  /** 명확화 라운드를 백그라운드로 — 결과는 SSE로 흐르고, 실패는 error 이벤트로 알린다. */
  function kickClarification(sessionId: string, threadKey: string, language?: 'ko' | 'en'): void {
    if (inFlight.has(sessionId)) return;
    inFlight.add(sessionId);
    void (async () => {
      try {
        await runner.startClarification({
          address: { sessionId },
          threadKey,
          channel: 'web',
          text: '',
          ...(language ? { language } : {}),
        });
      } catch (error) {
        console.error('[web] 라운드 실패:', error);
        broadcast(sessionId, 'error', {
          message: '질문 생성에 실패했어요 — 다시 시도할 수 있어요.',
        });
      } finally {
        inFlight.delete(sessionId);
        broadcastStatus(sessionId);
      }
    })();
  }

  /** 접수는 즉시 응답(F1 3초) — 질문 생성은 백그라운드, 결과는 SSE·세션 조회로. */
  async function handleIntake(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { text, name, language } = parseIntakeBody(await readJsonBody(req));
    const collector: Reply[] = [];
    const threadKey = `web:${randomUUID()}`;
    const { sessionId } = await runner.openSession({
      address: { collector },
      threadKey,
      channel: 'web',
      ...(name !== undefined ? { authorId: name } : {}),
      text,
      ...(language !== undefined ? { language } : {}),
    });
    sendJson(res, 201, {
      sessionId,
      status: 'intake',
      terminalState: null,
      ack: collector[0]?.text ?? '',
    });
    kickClarification(sessionId, threadKey, language);
  }

  async function handleReply(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    const session = store.getSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    if (!session.channelThreadKey) {
      sendJson(res, 409, { error: '이 세션은 웹에서 이어갈 수 없다 (스레드 키 없음)' });
      return;
    }
    const { text, name, language } = parseIntakeBody(await readJsonBody(req));
    const collector: Reply[] = [];
    const outcome = await runner.handleReply({
      address: { sessionId, collector },
      threadKey: session.channelThreadKey,
      channel: 'web',
      ...(name !== undefined ? { authorId: name } : {}),
      text,
      ...(language !== undefined ? { language } : {}),
    });
    if (!outcome) {
      sendJson(res, 409, {
        error: '이미 종결된 세션이다 — 새 요청으로 시작해 달라',
        status: session.status,
        terminalState: session.terminalState,
      });
      return;
    }
    broadcastStatus(sessionId);
    sendJson(res, 200, { ...outcome, replies: collector });
  }

  /** 슬롯 단위 요청자 확인 (F3) — confirmed=false는 정정 텍스트 필수. */
  async function handleSlotConfirm(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
    slotKey: string,
  ): Promise<void> {
    const session = store.getSession(sessionId);
    if (!session || !session.channelThreadKey) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    const body = await readJsonBody(req);
    if (typeof body.confirmed !== 'boolean') {
      throw new BadRequest('confirmed는 boolean이어야 한다');
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!body.confirmed && !text) {
      throw new BadRequest('정정(confirmed=false)에는 text가 필요하다');
    }
    const collector: Reply[] = [];
    const outcome = await runner.confirmSlot(
      {
        address: { sessionId, collector },
        threadKey: session.channelThreadKey,
        channel: 'web',
        text,
      },
      slotKey,
      body.confirmed,
    );
    if (!outcome) {
      sendJson(res, 409, { error: '슬롯 확인은 문서 완성 상태에서만 가능하다' });
      return;
    }
    broadcastStatus(sessionId);
    sendJson(res, 200, { ...outcome, replies: collector });
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
    if (!store.getSession(sessionId)) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    const status = statusOf(sessionId);
    if (status) sseSend(res, 'status', status);

    let clients = subscribers.get(sessionId);
    if (!clients) {
      clients = new Set();
      subscribers.set(sessionId, clients);
    }
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
      if (clients.size === 0) subscribers.delete(sessionId);
    });
  }

  /** 로컬 목록(#29)용 요약 — 클라이언트가 보관한 세션 ID들만 조회한다. 전체 나열 API는 없다. */
  function handleSummaries(res: ServerResponse, idsParam: string | null): void {
    const ids = (idsParam ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 50);
    const sessions = ids.flatMap((id) => {
      const session = store.getSession(id);
      if (!session) return [];
      const request = store
        .listUtterances(id)
        .find((utterance) => utterance.authorType === 'requester');
      return [
        {
          id,
          status: session.status,
          terminalState: session.terminalState,
          roundCount: session.roundCount,
          requestText: request?.originalText ?? '',
          updatedAt: session.updatedAt,
        },
      ];
    });
    sendJson(res, 200, { sessions });
  }

  function handleSessionDetail(res: ServerResponse, sessionId: string): void {
    const session = store.getSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    // 진행 중 세션이면 마지막 명확화 라운드의 질문 구조를 되돌린다 — 마법사 UI 복원 (US-8)
    const open = session.status === 'intake' || session.status === 'clarifying';
    const lastRound = open
      ? store
          .listSignals(sessionId)
          .filter((signal) => signal.type === 'clarification_round')
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
          .at(-1)
      : undefined;
    const labelBySlot = new Map<string, string>(
      TEMP_REQUIRED_SLOTS.map((slot) => [slot.key, slot.label]),
    );
    // 원문 전사는 상시 조회 대상 (US-11, 원칙 7). 요청자 식별자(authorId)는 내보내지 않는다.
    sendJson(res, 200, {
      latestQuestions: lastRound ? parseStoredQuestions(lastRound.payload) : null,
      roundBudget: runner.roundBudgetOf(sessionId),
      session: {
        id: session.id,
        status: session.status,
        terminalState: session.terminalState,
        roundCount: session.roundCount,
        originChannel: session.originChannel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        closedAt: session.closedAt,
      },
      utterances: store.listUtterances(sessionId).map((u) => ({
        seq: u.seq,
        authorType: u.authorType,
        originalText: u.originalText,
        originalLanguage: u.originalLanguage,
        createdAt: u.createdAt,
      })),
      slotStates: store.listSlotStates(sessionId).map((slot) => ({
        slotKey: slot.slotKey,
        label: labelBySlot.get(slot.slotKey) ?? slot.slotKey,
        state: slot.state,
        value: typeof slot.value === 'string' ? slot.value : null,
        confirmedByRequester: slot.confirmedByRequester,
        openIssueAssignee: slot.openIssueAssignee,
      })),
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && segments.length === 0) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>pm-jude API</title>' +
          '<p>pm-jude API 서버 — 웹 UI는 <code>pnpm web:ui</code> (http://localhost:3000)</p>',
      );
      return;
    }
    if (segments[0] === 'api' && segments[1] === 'sessions') {
      if (segments.length === 2) {
        if (req.method === 'POST') {
          await handleIntake(req, res);
          return;
        }
        if (req.method === 'GET') {
          handleSummaries(res, url.searchParams.get('ids'));
          return;
        }
      }
      const sessionId = segments[2];
      if (sessionId !== undefined) {
        if (req.method === 'GET' && segments.length === 3) {
          handleSessionDetail(res, sessionId);
          return;
        }
        if (req.method === 'GET' && segments.length === 4 && segments[3] === 'events') {
          handleEvents(req, res, sessionId);
          return;
        }
        if (req.method === 'POST' && segments.length === 4 && segments[3] === 'replies') {
          await handleReply(req, res, sessionId);
          return;
        }
        if (req.method === 'POST' && segments.length === 4 && segments[3] === 'rounds') {
          // 백그라운드 라운드 실패 시 재시도 경로 — intake 상태에서만 의미가 있다
          const session = store.getSession(sessionId);
          if (!session || !session.channelThreadKey) {
            sendJson(res, 404, { error: '세션 없음' });
            return;
          }
          kickClarification(sessionId, session.channelThreadKey);
          sendJson(res, 202, { accepted: true });
          return;
        }
        if (req.method === 'POST' && segments.length === 5 && segments[3] === 'slots') {
          await handleSlotConfirm(req, res, sessionId, decodeURIComponent(segments[4] ?? ''));
          return;
        }
      }
    }
    sendJson(res, 404, { error: '지원하지 않는 경로' });
  }

  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof BadRequest) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      console.error('[web] 처리 실패:', error);
      if (!res.headersSent) sendJson(res, 500, { error: '서버 오류' });
      else res.end();
    });
  });
}
