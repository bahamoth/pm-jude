import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LlmBackend } from '../gateway/backend';
import type { LlmGateway, UsageLogger } from '../gateway/gateway';
import { clarificationOutputSchema } from '../prompts/clarification-v0';
import type { PromptRegistry } from '../prompts/registry';
import {
  DEFAULT_ATTACHMENT_LIMITS,
  IntakeRunner,
  TEMP_REQUIRED_SLOTS,
  UploadRejectedError,
  UtteranceRejectedError,
  type AttachmentLimits,
  type ChannelPort,
  type ClarificationRoundPayload,
} from '../runner/core-runner';
import type { NotionPageSource } from '../connect/notion';
import type { ExtractorRegistry } from '../extract/registry';
import { renderMockupHtml } from '../mockup/render';
import { ThemeRegistry } from '../mockup/theme-registry';
import { BlobNotFoundError, type AttachmentStore } from '../store/attachment-store';
import type { SessionStore } from '../store/session-store';
import { handleDevSite } from './dev-site';

/**
 * 웹 채널 어댑터 (#16·#35, ADR-0007/0008) — Node 내장 http 로컬 단일 프로세스 서버.
 * 접수·답변·정정의 LLM 라운드는 전부 백그라운드로 돌고(POST는 즉시 응답 — F1),
 * 결과는 세션 이벤트 스트림(SSE)으로 푸시된다(#31). 수명 규칙은 서버가 강제한다:
 * 처리 중이 아닌 세션의 구독은 현재 상태만 주고 즉시 닫으며, 처리가 끝나면 서버가
 * 구독을 닫는다 — 동시 연결 수 = 진행 중 라운드 수. 저장소가 진실 원천이므로
 * 놓친 이벤트 개념은 없고, 폴백은 세션 조회다. 로직은 코어 러너 몫 — 여기는 배선만.
 */

export interface WebServerDeps {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  usageLogger?: UsageLogger;
  teamLanguage?: string;
  maxRounds?: number;
  /** 첨부 원본 저장소·추출기 (F1-Attach). 없으면 업로드 표면이 열리지 않는다. */
  attachmentStore?: AttachmentStore;
  createExtractors?: (gateway: LlmGateway) => ExtractorRegistry;
  limits?: AttachmentLimits;
  /** 디자인 시스템 선정 후보 (F4, #54) — 없으면 내장 프리셋. */
  themes?: ThemeRegistry;
  maxMockupIterations?: number;
  /** 요청자 발화 길이 상한 (#58, ADR-0014). 기본은 러너의 10k자. */
  maxUtteranceChars?: number;
  /** 노션 페이지 소스 (#57, ADR-0013). 없으면 노션 URL은 텍스트로 남는다. */
  notion?: NotionPageSource;
  /** 장문 첨부 압축 수치 (#58, ADR-0014). */
  condense?: { targetChars?: number; budgetChars?: number };
  /** 게이트웨이 전역 상한 (#59, ADR-0015). */
  llm?: { timeoutMs?: number; maxConcurrency?: number };
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

/**
 * 업로드 본문을 그대로 읽는다 — multipart 파서를 들이지 않는 대신 요청 하나에 파일 하나다.
 *
 * 상한 초과는 두 단계로 막는다. Content-Length가 이미 넘으면 본문을 받기 전에 끊고, 헤더가
 * 없거나 거짓이면 읽되 버퍼에 쌓지 않는다. **소켓을 죽이지는 않는다** — 연결을 끊으면 거부
 * 사유가 요청자에게 닿지 못해 무엇이 잘못됐는지 알 수 없는 실패가 된다(P-U1).
 */
function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(new UploadRejectedError('파일이 너무 크다'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // 메모리는 지키되 스트림은 끝까지 흘려보낸다 — 응답을 돌려주기 위해
        overLimit = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overLimit) {
        reject(new UploadRejectedError('파일이 너무 크다'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

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

/** 발화 제출이 참조하는 업로드 목록 (F1-Attach) — 값이 있으면 문자열 배열이어야 한다. */
function parseUploadIds(body: Record<string, unknown>): string[] {
  if (body.uploadIds === undefined) return [];
  if (!Array.isArray(body.uploadIds) || body.uploadIds.some((id) => typeof id !== 'string')) {
    throw new BadRequest('uploadIds는 문자열 배열이어야 한다');
  }
  return body.uploadIds as string[];
}

/** 목업 어노테이션 본문 (F4) — 비어 있지 않은 코멘트 최소 1건. */
function parseComments(
  body: Record<string, unknown>,
): Array<{ text: string; elementRef?: string }> {
  if (!Array.isArray(body.comments) || body.comments.length === 0) {
    throw new BadRequest('comments는 비어 있지 않은 배열이어야 한다');
  }
  return body.comments.map((entry) => {
    const { text, elementRef } = (entry ?? {}) as Record<string, unknown>;
    if (typeof text !== 'string' || !text.trim()) {
      throw new BadRequest('코멘트 text는 비어 있지 않은 문자열이어야 한다');
    }
    return {
      text: text.trim(),
      ...(typeof elementRef === 'string' && elementRef ? { elementRef } : {}),
    };
  });
}

function parseIntakeBody(body: Record<string, unknown>): {
  text: string;
  name?: string;
  language?: 'ko' | 'en';
  uploadIds?: string[];
} {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new BadRequest('text는 비어 있지 않은 문자열이어야 한다');
  if (body.language !== undefined && body.language !== 'ko' && body.language !== 'en') {
    throw new BadRequest('language는 ko 또는 en이어야 한다');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const uploadIds = parseUploadIds(body);
  return {
    text,
    ...(name ? { name } : {}),
    ...(body.language !== undefined ? { language: body.language as 'ko' | 'en' } : {}),
    ...(uploadIds.length > 0 ? { uploadIds } : {}),
  };
}

export function createWebServer(deps: WebServerDeps): Server {
  const { store } = deps;

  // 세션 이벤트 스트림 (#31) — 구독자와 진행 중 백그라운드 라운드
  const subscribers = new Map<string, Set<ServerResponse>>();
  const inFlight = new Set<string>();

  function sseSend(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(sessionId: string, event: string, data: unknown): void {
    for (const res of subscribers.get(sessionId) ?? []) sseSend(res, event, data);
  }

  /**
   * 마지막 명확화 라운드 신호 — 그 id가 라운드 식별자다 (G-10). 답변 제출이 이 값을 동반해야
   * 스테일 제출(다른 탭이 이미 넘긴 이전 라운드 질문의 답)을 최신 질문의 답으로 오결합하지 않는다.
   */
  function latestRoundSignal(sessionId: string) {
    return store
      .listSignals(sessionId)
      .filter((signal) => signal.type === 'clarification_round')
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .at(-1);
  }

  /**
   * 이 라운드가 이미 답을 받았는가 (G-10) — 라운드 신호에 남은 질문 발화 순번 뒤로 요청자 발화가
   * 있으면 그렇다. 최신 라운드 id를 들고 오더라도 그 라운드가 소비됐으면 스테일 제출이다:
   * 다른 탭이 답해 라운드가 종결(보류)됐거나 판정이 도는 중인 경우가 여기 걸린다.
   */
  function isAnswered(sessionId: string, payload: unknown): boolean {
    const seq = (payload as { utteranceSeq?: unknown } | null)?.utteranceSeq;
    if (typeof seq !== 'number') return false; // 순번이 없는 과거 라운드는 판별하지 않는다
    return store
      .listUtterances(sessionId)
      .some((utterance) => utterance.authorType === 'requester' && utterance.seq > seq);
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
      processing: inFlight.has(sessionId),
    };
  }

  /** 처리 종료 시 서버가 구독을 닫는다 — 수명 규칙 강제 (#31: 연결은 처리 구간에만). */
  function closeSubscribers(sessionId: string): void {
    for (const res of subscribers.get(sessionId) ?? []) res.end();
    subscribers.delete(sessionId);
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
  const themes = deps.themes ?? ThemeRegistry.withBuiltins();
  const runner = new IntakeRunner<WebAddress>({ ...deps, themes, port });
  const limits = deps.limits ?? DEFAULT_ATTACHMENT_LIMITS;

  /**
   * LLM 라운드를 백그라운드로 — 세션당 동시 1개(경합 방지). 종료 시 최종 status를
   * 브로드캐스트하고 구독을 서버가 닫는다. 실패는 round_failed 이벤트.
   */
  function runInBackground(sessionId: string, work: () => Promise<unknown>): boolean {
    if (inFlight.has(sessionId)) return false;
    inFlight.add(sessionId);
    void (async () => {
      try {
        await work();
      } catch (error) {
        console.error('[web] 라운드 실패:', error);
        broadcast(sessionId, 'round_failed', {
          message: '처리에 실패했어요 — 다시 시도할 수 있어요.',
        });
      } finally {
        inFlight.delete(sessionId);
        const status = statusOf(sessionId);
        if (status) broadcast(sessionId, 'status', status);
        closeSubscribers(sessionId);
      }
    })();
    return true;
  }

  function kickClarification(sessionId: string, threadKey: string, language?: 'ko' | 'en'): void {
    runInBackground(sessionId, () =>
      runner.startClarification({
        address: { sessionId },
        threadKey,
        channel: 'web',
        text: '',
        ...(language ? { language } : {}),
      }),
    );
  }

  /**
   * 업로드 스테이징 (F1-Attach, ADR-0011 결정 10) — 인테이크 시점에는 세션이 없으므로
   * 파일이 먼저 온다. 검증은 여기서 동기로 끝내고 거부 사유를 즉시 말한다(P-U1):
   * 제출하고 나서 실패를 알게 되는 경로를 만들지 않는다. 읽는 일은 라운드 백그라운드 몫.
   */
  async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { attachmentStore } = deps;
    if (!attachmentStore || !runner.attachmentsEnabled) {
      sendJson(res, 404, { error: '이 서버는 자료 첨부를 받지 않는다' });
      return;
    }
    const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    const rawName = req.headers['x-filename'];
    if (typeof rawName !== 'string' || !rawName) {
      throw new BadRequest('X-Filename 헤더가 필요하다');
    }
    let filename: string;
    try {
      filename = decodeURIComponent(rawName);
    } catch {
      throw new BadRequest('X-Filename은 URI 인코딩된 파일명이어야 한다');
    }
    const bytes = await readRawBody(req, limits.maxBytesPerFile);
    runner.validateUpload({ mime, bytes: bytes.length });
    if (bytes.length === 0) throw new UploadRejectedError('빈 파일이다');

    const stored = attachmentStore.put(bytes);
    const uploadId = store.stageUpload({
      filename,
      mime,
      bytes: bytes.length,
      sha256: stored.sha256,
      storageRef: stored.storageRef,
    });
    sendJson(res, 201, { uploadId, filename, mime, bytes: bytes.length });
  }

  /**
   * 첨부 원본 내려주기 (ADR-0011 결정 13) — 브라우저 인라인 렌더를 원천 배제한다.
   * 첨부는 요청자가 올린 임의의 파일이므로 표시 대상이 아니라 내려받기 대상이다.
   */
  function handleAttachmentDownload(
    res: ServerResponse,
    sessionId: string,
    attachmentId: string,
  ): void {
    const { attachmentStore } = deps;
    const row = store.getAttachment(attachmentId);
    // 세션 스코프 — 다른 세션의 첨부 id를 알아도 이 경로로는 꺼낼 수 없다
    if (!attachmentStore || !row || row.sessionId !== sessionId) {
      sendJson(res, 404, { error: '첨부 없음' });
      return;
    }
    let bytes: Buffer;
    try {
      bytes = attachmentStore.read(row.storageRef);
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        sendJson(res, 404, { error: '원본을 찾을 수 없음' });
        return;
      }
      throw error;
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': bytes.length,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    res.end(bytes);
  }

  /** 접수는 즉시 응답(F1 3초) — 질문 생성은 백그라운드, 결과는 SSE·세션 조회로. */
  async function handleIntake(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { text, name, language, uploadIds } = parseIntakeBody(await readJsonBody(req));
    const collector: Reply[] = [];
    const threadKey = `web:${randomUUID()}`;
    const { sessionId } = await runner.openSession({
      address: { collector },
      threadKey,
      channel: 'web',
      ...(name !== undefined ? { authorId: name } : {}),
      text,
      ...(language !== undefined ? { language } : {}),
      ...(uploadIds ? { uploadIds } : {}),
    });
    sendJson(res, 201, {
      sessionId,
      status: 'intake',
      terminalState: null,
      ack: collector[0]?.text ?? '',
    });
    kickClarification(sessionId, threadKey, language);
  }

  /** 답변 접수 → 202 즉시, 판정·다음 라운드·문서는 백그라운드 + SSE (#31). */
  async function handleReply(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    const session = store.getSession(sessionId);
    if (!session || !session.channelThreadKey) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    // documented의 일반 답변은 막는다 — 정정은 슬롯 확인 경로(§6)만 (Spec 리뷰 6).
    // 코어에도 채널 무관 가드가 있다(#52) — 이 409는 UI가 열지 않는 직접 API 호출에
    // 대한 계약 방어라 발화·신호를 남기지 않고, 전달 채널의 실사용 답글은 코어가 받는다.
    if (session.status === 'documented') {
      sendJson(res, 409, {
        error: '문서가 완성된 요청이에요 — 항목별 확인·정정으로 고칠 수 있어요.',
      });
      return;
    }
    if (session.status === 'closed' && session.terminalState !== 'on_hold_insufficient_info') {
      sendJson(res, 409, { error: '이미 종결된 세션이다 — 새 요청으로 시작해 달라' });
      return;
    }
    const body = await readJsonBody(req);
    // 라운드 정합 계약 (§6, G-10): 질문에 답하는 제출은 응답 대상 라운드를 명시해야 하고,
    // 명시된 라운드가 최신이 아니면 상태와 무관하게 거부한다 — 다른 탭이 이미 라운드를
    // 넘겼거나(다음 라운드) 그 라운드로 세션이 종결된 경우 모두 스테일이다.
    // 보류 화면의 재개 입력에는 답할 라운드가 없으므로 roundId를 요구하지 않는다.
    const latestRound = latestRoundSignal(sessionId);
    const roundId = typeof body.roundId === 'string' ? body.roundId : '';
    if (!roundId && session.status === 'clarifying' && latestRound) {
      throw new BadRequest('roundId는 응답 대상 라운드 식별자여야 한다');
    }
    if (roundId && (roundId !== latestRound?.id || isAnswered(sessionId, latestRound.payload))) {
      sendJson(res, 409, {
        code: 'stale_round',
        error: '이 질문은 이미 지난 라운드예요 — 최신 질문을 불러올게요.',
      });
      return;
    }
    const { text, name, language, uploadIds } = parseIntakeBody(body);
    const accepted = runInBackground(sessionId, () =>
      runner.handleReply({
        address: { sessionId },
        threadKey: session.channelThreadKey ?? '',
        channel: 'web',
        ...(name !== undefined ? { authorId: name } : {}),
        text,
        ...(language !== undefined ? { language } : {}),
        ...(uploadIds ? { uploadIds } : {}),
      }),
    );
    if (!accepted) {
      sendJson(res, 409, { error: '이미 처리 중이에요 — 잠시 뒤 다시 시도해 주세요.' });
      return;
    }
    sendJson(res, 202, { sessionId, accepted: true });
  }

  /** 슬롯 단위 요청자 확인 (F3) — 맞아요는 즉시(무 LLM), 정정은 백그라운드 라운드. */
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
    const uploadIds = parseUploadIds(body);
    const event = {
      address: { sessionId },
      threadKey: session.channelThreadKey,
      channel: 'web' as const,
      text,
      // 정정에도 자료를 붙일 수 있다 — 요청자가 입력을 넣는 지점이면 어디든 (ADR-0011 결정 2)
      ...(uploadIds.length > 0 ? { uploadIds } : {}),
    };
    if (body.confirmed) {
      const outcome = await runner.confirmSlot(event, slotKey, true);
      if (!outcome) {
        sendJson(res, 409, { error: '슬롯 확인은 문서 완성 상태에서만 가능하다' });
        return;
      }
      sendJson(res, 200, outcome);
      return;
    }
    if (session.status !== 'documented') {
      sendJson(res, 409, { error: '슬롯 확인은 문서 완성 상태에서만 가능하다' });
      return;
    }
    const accepted = runInBackground(sessionId, () => runner.confirmSlot(event, slotKey, false));
    if (!accepted) {
      sendJson(res, 409, { error: '이미 처리 중이에요 — 잠시 뒤 다시 시도해 주세요.' });
      return;
    }
    sendJson(res, 202, { sessionId, accepted: true });
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

    // 수명 규칙 강제: 처리 중이 아니면 현재 상태만 주고 즉시 닫는다 — 유휴 연결 불허
    if (!inFlight.has(sessionId)) {
      res.end();
      return;
    }

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
      const openIssueCount = store
        .listSlotStates(id)
        .filter((slot) => slot.state === 'promoted').length;
      return [
        {
          id,
          status: session.status,
          terminalState: session.terminalState,
          roundCount: session.roundCount,
          requestText: request?.originalText ?? '',
          updatedAt: session.updatedAt,
          openIssueCount,
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
    const lastRound = latestRoundSignal(sessionId);
    const labelBySlot = new Map<string, string>(
      TEMP_REQUIRED_SLOTS.map((slot) => [slot.key, slot.label]),
    );
    // 원문 전사는 상시 조회 대상 (US-11, 원칙 7). 요청자 식별자(authorId)는 내보내지 않는다.
    sendJson(res, 200, {
      latestQuestions: open && lastRound ? parseStoredQuestions(lastRound.payload) : null,
      /** 답변 제출이 동반해야 하는 라운드 식별자 (G-10 라운드 정합). */
      roundId: lastRound?.id ?? null,
      /** 죽은 채 남은 라운드 — 화면의 재시도 CTA 근거. 판정은 코어가 한다 (G-10). */
      pendingRound: session.channelThreadKey ? runner.pendingRound(session.channelThreadKey) : null,
      /** 지금까지 게시된 문서 수 = 현재 문서의 vN (G-11). 문서 전이라면 0. */
      documentVersion: runner.documentVersionOf(sessionId),
      /**
       * 최신 문서 버전의 정본 구조체 (#53) — 화면은 게시 텍스트 역파싱이 아니라 이걸 렌더한다.
       * 저장 행이 없는 레거시 세션은 null — 클라이언트가 발화 텍스트 파서로 폴백한다.
       */
      document: (() => {
        const latest = store.latestRequirementsDoc(sessionId);
        return latest ? { version: latest.version, content: latest.content } : null;
      })(),
      /** 현재 문서 버전에서 전 슬롯 확인이 끝났는가 — Phase 0 종착 (G-11). */
      completed: runner.isCompleted(sessionId),
      /** 목업 요약 (F4, #54) — 화면이 목업 패널을 열 근거. 상세는 목업 상태 조회로. */
      mockup: (() => {
        const latest = store.latestMockup(sessionId);
        return latest
          ? {
              latestVersion: latest.version,
              docVersion: latest.docVersion,
              convergence: latest.convergence,
              selectedTheme: latest.selectedTheme,
              themeDelegated: latest.themeDelegated,
            }
          : null;
      })(),
      roundBudget: runner.roundBudgetOf(sessionId),
      processing: inFlight.has(sessionId),
      session: {
        id: session.id,
        status: session.status,
        terminalState: session.terminalState,
        roundCount: session.roundCount,
        // 세션이 쓴 LLM 사용량 (#63) — 상한으로 막는 대신 요청자·운영자에게 보여준다
        usage: {
          totalTokens: session.totalTokens,
          totalCostUsd: session.totalCostUsd,
          llmCallCount: session.llmCallCount,
        },
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
        // 첨부에서 읽은 값은 화면이 출처를 표시한다 (F2c, ADR-0011 결정 8)
        evidenceAttachmentId: slot.evidenceAttachmentId,
        openIssueAssignee: slot.openIssueAssignee,
      })),
      /**
       * 첨부 현황 (F1-Attach) — 추출 텍스트는 내보내지 않는다. 화면이 보여줄 것은 무엇을
       * 올렸고 읽혔는지이며, 자료 내용은 원본 다운로드로 본다. 읽지 못한 자료도 사유와 함께
       * 남는다 — 올린 자료가 조용히 사라지지 않는다.
       */
      attachments: store.listAttachments(sessionId).map((row) => ({
        id: row.id,
        filename: row.filename,
        mime: row.mime,
        bytes: row.bytes,
        extractionStatus: row.extractionStatus,
        extractionError: row.extractionError,
      })),
      /** 업로드 표면을 열지 판단하는 근거 — 지원 형식과 상한을 미리 고지한다. */
      uploads: uploadPolicy(),
    });
  }

  /**
   * 목업 HTML 서빙 (F4 호스팅·보안, #54) — 샌드박스 CSP로 외부 네트워크를 차단하고
   * 워터마크·테마는 렌더러(코드)가 입힌다. ?theme=은 선정 화면의 미리보기, 기본값은
   * 선정된 테마이고 선정 전에는 그레이스케일이다. 분리 usercontent 도메인은 결정 대기.
   */
  function handleMockupServe(
    res: ServerResponse,
    sessionId: string,
    versionParam: string,
    themeParam: string | null,
  ): void {
    const version = Number(versionParam);
    const row = Number.isInteger(version) ? store.getMockup(sessionId, version) : undefined;
    if (!row) {
      sendJson(res, 404, { error: '목업 없음' });
      return;
    }
    const themeId = themeParam ?? row.selectedTheme;
    const theme = themeId ? themes.get(themeId) : undefined;
    const requesterLanguage = store
      .listUtterances(sessionId)
      .find((utterance) => utterance.authorType === 'requester')?.originalLanguage;
    const html = renderMockupHtml({
      html: row.html,
      ...(theme ? { theme } : {}),
      language: requesterLanguage === 'en' ? 'en' : 'ko',
    });
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // 외부 네트워크 차단 — self-contained 목업의 인라인 스타일·스크립트만 허용 (F4)
      'content-security-policy':
        "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  /** 목업 반복 상태 조회 — 버전·예산·수렴·테마 후보·어노테이션. 화면 복원의 근거. */
  function handleMockupState(res: ServerResponse, sessionId: string): void {
    const mockups = store.listMockups(sessionId);
    const latest = mockups.at(-1);
    if (!latest) {
      sendJson(res, 404, { error: '목업 없음' });
      return;
    }
    sendJson(res, 200, {
      latestVersion: latest.version,
      docVersion: latest.docVersion,
      convergence: latest.convergence,
      selectedTheme: latest.selectedTheme,
      themeDelegated: latest.themeDelegated,
      iterationsUsed: runner.mockupIterationsUsed(sessionId),
      iterationBudget: runner.mockupIterationBudget,
      versions: mockups.map((mockup) => ({
        version: mockup.version,
        docVersion: mockup.docVersion,
        summary: mockup.summary,
        createdAt: mockup.createdAt,
      })),
      themes: runner.themeCandidates(),
      annotations: store.listMockupAnnotationsWithVersions(sessionId),
      processing: inFlight.has(sessionId),
    });
  }

  /** 어노테이션 접수 → 202 즉시, 재생성은 백그라운드 (F4). 스테일 판 코멘트는 409. */
  async function handleMockupAnnotations(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    const session = store.getSession(sessionId);
    if (!session?.channelThreadKey) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    const latest = store.latestMockup(sessionId);
    if (!latest || session.status !== 'mockup') {
      sendJson(res, 409, { error: '지금은 목업 코멘트를 받을 수 없어요.' });
      return;
    }
    const body = await readJsonBody(req);
    if (body.mockupVersion !== latest.version) {
      sendJson(res, 409, {
        code: 'stale_mockup',
        error: '이 코멘트는 이전 판의 것이에요 — 최신 판을 불러올게요.',
      });
      return;
    }
    const comments = parseComments(body);
    const threadKey = session.channelThreadKey;
    const accepted = runInBackground(sessionId, () =>
      runner.annotateMockup(
        { address: { sessionId }, threadKey, channel: 'web', text: '' },
        comments,
      ),
    );
    if (!accepted) {
      sendJson(res, 409, { error: '이미 처리 중이에요 — 잠시 뒤 다시 시도해 주세요.' });
      return;
    }
    sendJson(res, 202, { sessionId, accepted: true });
  }

  /** 디자인 시스템 선정 (F4) — LLM 없는 동기 처리. 후보 밖 id는 400. */
  async function handleMockupTheme(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<void> {
    const session = store.getSession(sessionId);
    if (!session?.channelThreadKey) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    const body = await readJsonBody(req);
    const delegated = body.delegated === true;
    const themeId = typeof body.themeId === 'string' ? body.themeId : '';
    if (!delegated && !themeId) throw new BadRequest('themeId 또는 delegated가 필요하다');
    if (!delegated && !themes.get(themeId)) {
      sendJson(res, 400, { error: `등록되지 않은 테마: ${themeId}` });
      return;
    }
    const outcome = await runner.selectMockupTheme(
      { address: { sessionId }, threadKey: session.channelThreadKey, channel: 'web', text: '' },
      delegated ? { delegated: true } : { themeId },
    );
    if (!outcome) {
      sendJson(res, 409, { error: '지금은 테마를 선정할 수 없어요.' });
      return;
    }
    sendJson(res, 200, outcome);
  }

  /** 목업 최종 승인 → 202 즉시, 역주입은 백그라운드 (F4 역주입). 테마 미결정은 409. */
  function handleMockupApproval(res: ServerResponse, sessionId: string): void {
    const session = store.getSession(sessionId);
    if (!session?.channelThreadKey) {
      sendJson(res, 404, { error: '세션 없음' });
      return;
    }
    const latest = store.latestMockup(sessionId);
    if (!latest || session.status !== 'mockup' || latest.convergence !== 'iterating') {
      sendJson(res, 409, { error: '지금은 목업을 승인할 수 없어요.' });
      return;
    }
    if (!latest.selectedTheme && !latest.themeDelegated) {
      sendJson(res, 409, {
        code: 'theme_required',
        error: '분위기를 하나 골라 주시거나 개발팀에 맡겨 주세요 — 그다음 최종 확인할 수 있어요.',
      });
      return;
    }
    const threadKey = session.channelThreadKey;
    const accepted = runInBackground(sessionId, () =>
      runner.approveMockup({ address: { sessionId }, threadKey, channel: 'web', text: '' }),
    );
    if (!accepted) {
      sendJson(res, 409, { error: '이미 처리 중이에요 — 잠시 뒤 다시 시도해 주세요.' });
      return;
    }
    sendJson(res, 202, { sessionId, accepted: true });
  }

  /** 업로드 가능 여부와 상한 — 세션 조회와 정책 조회가 같은 답을 준다. */
  function uploadPolicy(): Record<string, unknown> {
    return runner.attachmentsEnabled
      ? {
          enabled: true,
          supportedMimes: runner.supportedUploadMimes(),
          maxBytesPerFile: limits.maxBytesPerFile,
          maxPerSession: limits.maxPerSession,
        }
      : { enabled: false };
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    // 로컬 허브 (#36) — /, /board, /trace, /repo/** (운영자·개발팀 열람 표면)
    if (handleDevSite(req, res, url, store)) return;
    // 업로드는 세션 밖 경로다 — 인테이크 시점에는 아직 세션이 없다 (ADR-0011 결정 10)
    if (segments[0] === 'api' && segments[1] === 'uploads' && segments.length === 2) {
      if (req.method === 'POST') {
        await handleUpload(req, res);
        return;
      }
      // 세션 없는 화면(인테이크 폼)도 무엇을 올릴 수 있는지 미리 알아야 한다 (P-U1)
      if (req.method === 'GET') {
        sendJson(res, 200, uploadPolicy());
        return;
      }
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
          // 실패한 라운드의 멱등 재시도 (G-10) — 죽은 단계만 다시 돌린다. 재시도할 미완 라운드가
          // 없으면 거부한다: 재시도가 새 라운드를 만들어 예산을 먹는 일이 없어야 한다.
          const session = store.getSession(sessionId);
          if (!session?.channelThreadKey) {
            sendJson(res, 404, { error: '세션 없음' });
            return;
          }
          const threadKey = session.channelThreadKey;
          if (runner.pendingRound(threadKey) === null) {
            sendJson(res, 409, {
              code: 'nothing_to_retry',
              error: '다시 시도할 처리가 없어요 — 최신 상태를 불러올게요.',
            });
            return;
          }
          const retrying = runInBackground(sessionId, () =>
            runner.retryRound({ address: { sessionId }, threadKey, channel: 'web', text: '' }),
          );
          if (!retrying) {
            sendJson(res, 409, { error: '이미 처리 중이에요 — 잠시 뒤 다시 시도해 주세요.' });
            return;
          }
          sendJson(res, 202, { accepted: true });
          return;
        }
        if (req.method === 'GET' && segments.length === 5 && segments[3] === 'attachments') {
          handleAttachmentDownload(res, sessionId, segments[4] ?? '');
          return;
        }
        // 목업 반복·디자인 시스템 선정 (F4, #54)
        if (req.method === 'GET' && segments.length === 4 && segments[3] === 'mockup') {
          handleMockupState(res, sessionId);
          return;
        }
        if (req.method === 'GET' && segments.length === 5 && segments[3] === 'mockups') {
          handleMockupServe(res, sessionId, segments[4] ?? '', url.searchParams.get('theme'));
          return;
        }
        if (req.method === 'POST' && segments.length === 5 && segments[3] === 'mockup') {
          if (segments[4] === 'annotations') {
            await handleMockupAnnotations(req, res, sessionId);
            return;
          }
          if (segments[4] === 'theme') {
            await handleMockupTheme(req, res, sessionId);
            return;
          }
          if (segments[4] === 'approval') {
            handleMockupApproval(res, sessionId);
            return;
          }
        }
        if (req.method === 'POST' && segments.length === 5 && segments[3] === 'slots') {
          let slotKey: string;
          try {
            slotKey = decodeURIComponent(segments[4] ?? '');
          } catch {
            throw new BadRequest('잘못된 슬롯 키');
          }
          await handleSlotConfirm(req, res, sessionId, slotKey);
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
      // 업로드 거부는 사유를 그대로 요청자에게 전한다 — 무엇이 왜 거부됐는지 알아야 다시 올린다
      if (error instanceof UploadRejectedError) {
        if (!res.headersSent) sendJson(res, 400, { code: 'upload_rejected', error: error.message });
        else res.end();
        return;
      }
      // 발화 길이 거부도 같다 — 대안(첨부·링크)까지 담긴 안내가 그대로 간다 (#58)
      if (error instanceof UtteranceRejectedError) {
        if (!res.headersSent)
          sendJson(res, 400, { code: 'utterance_rejected', error: error.message });
        else res.end();
        return;
      }
      console.error('[web] 처리 실패:', error);
      if (!res.headersSent) sendJson(res, 500, { error: '서버 오류' });
      else res.end();
    });
  });
}
