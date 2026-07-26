import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LlmBackend } from '../gateway/backend';
import type { UsageLogger } from '../gateway/gateway';
import type { PromptRegistry } from '../prompts/registry';
import {
  IntakeRunner,
  type ChannelPort,
  type ClarificationRoundPayload,
} from '../runner/core-runner';
import type { SessionStore } from '../store/session-store';
import { WEB_PAGE_HTML } from './page';

/**
 * 웹 채널 어댑터 (#16, ADR-0007) — Node 내장 http 로컬 단일 프로세스 서버.
 * 웹 프레임워크 선택은 ARCHITECTURE.md 결정 대기 항목이라 PoC에서 선점하지 않는다.
 * 회신 주소는 요청 단위 수집기다: 코어가 포트로 게시한 회신을 모아 HTTP 응답으로 돌려준다
 * (SlackPort와 대칭 — 채널 어댑터 원칙). 로직은 코어 러너 몫이고 여기는 HTTP 배선만 갖는다.
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

interface ReplyCollector {
  replies: Reply[];
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
 * 형태가 어긋나면 null — 어댑터는 자유 입력으로 강등한다.
 */
function parseStoredQuestions(payload: unknown): ReplyQuestion[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { questions } = payload as { questions?: unknown };
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const parsed: ReplyQuestion[] = [];
  for (const [i, raw] of questions.entries()) {
    if (typeof raw !== 'object' || raw === null) return null;
    const q = raw as {
      question?: unknown;
      exampleOptions?: unknown;
      dontKnowPath?: { label?: unknown };
    };
    if (typeof q.question !== 'string' || typeof q.dontKnowPath?.label !== 'string') return null;
    if (!Array.isArray(q.exampleOptions) || q.exampleOptions.some((o) => typeof o !== 'string')) {
      return null;
    }
    parsed.push({
      index: i + 1,
      question: q.question,
      exampleOptions: q.exampleOptions as string[],
      dontKnowLabel: q.dontKnowPath.label,
    });
  }
  return parsed;
}

const collectorPort: ChannelPort<ReplyCollector> = {
  post(address, text, payload) {
    address.replies.push({
      text,
      ...(payload?.kind === 'clarification_questions'
        ? { questions: toReplyQuestions(payload) }
        : {}),
    });
    return Promise.resolve();
  },
};

const MAX_BODY_BYTES = 1_000_000;

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
  const runner = new IntakeRunner<ReplyCollector>({ ...deps, port: collectorPort });

  async function handleIntake(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { text, name, language } = parseIntakeBody(await readJsonBody(req));
    const collector: ReplyCollector = { replies: [] };
    const { sessionId } = await runner.handleIntake({
      address: collector,
      threadKey: `web:${randomUUID()}`,
      channel: 'web',
      ...(name !== undefined ? { authorId: name } : {}),
      text,
      ...(language !== undefined ? { language } : {}),
    });
    const session = store.getSession(sessionId);
    sendJson(res, 201, {
      sessionId,
      status: session?.status ?? 'intake',
      terminalState: session?.terminalState ?? null,
      replies: collector.replies,
    });
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
    const collector: ReplyCollector = { replies: [] };
    const outcome = await runner.handleReply({
      address: collector,
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
    sendJson(res, 200, { ...outcome, replies: collector.replies });
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
    // 원문 전사는 상시 조회 대상 (US-11, 원칙 7). 요청자 식별자(authorId)는 내보내지 않는다.
    sendJson(res, 200, {
      latestQuestions: lastRound ? parseStoredQuestions(lastRound.payload) : null,
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
        state: slot.state,
        openIssueAssignee: slot.openIssueAssignee,
      })),
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && segments.length === 0) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(WEB_PAGE_HTML);
      return;
    }
    if (segments[0] === 'api' && segments[1] === 'sessions') {
      if (req.method === 'POST' && segments.length === 2) {
        await handleIntake(req, res);
        return;
      }
      const sessionId = segments[2];
      if (sessionId !== undefined) {
        if (req.method === 'GET' && segments.length === 3) {
          handleSessionDetail(res, sessionId);
          return;
        }
        if (req.method === 'POST' && segments.length === 4 && segments[3] === 'replies') {
          await handleReply(req, res, sessionId);
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
