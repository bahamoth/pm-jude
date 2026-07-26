import {
  ApiError,
  type Accepted,
  type IntakeResult,
  type ReplyOutcome,
  type SessionDetail,
  type SessionSummary,
} from './types';

// /api는 next.config 프록시로 API 서버(pnpm web)에 닿는다 (ADR-0008).

// 게이트웨이 LLM 타임아웃(기본 120초)보다 여유를 두고 끊는다 — 무한 대기 방지.
const REQUEST_TIMEOUT_MS = 150_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(0, '응답이 늦어지고 있어요 — 잠시 후 새로고침으로 이어갈 수 있어요.');
    }
    throw error;
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `요청 실패 (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export function startSession(input: {
  name?: string;
  language: 'ko' | 'en';
  text: string;
}): Promise<IntakeResult> {
  return request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** 202 접수 — 판정·다음 라운드·문서는 백그라운드에서 돌고 SSE·조회로 온다. */
export function sendReply(sessionId: string, text: string): Promise<Accepted> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

/** 맞아요(즉시 200) — LLM 호출이 없다. */
export function confirmSlotOk(sessionId: string, slotKey: string): Promise<ReplyOutcome> {
  return request(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/${encodeURIComponent(slotKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    },
  );
}

/** 아니에요 + 정정(202) — 재판정이 백그라운드로 돈다. */
export function correctSlot(sessionId: string, slotKey: string, text: string): Promise<Accepted> {
  return request(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/${encodeURIComponent(slotKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: false, text }),
    },
  );
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function getSummaries(ids: string[]): Promise<{ sessions: SessionSummary[] }> {
  if (ids.length === 0) return Promise.resolve({ sessions: [] });
  return request(`/api/sessions?ids=${ids.map(encodeURIComponent).join(',')}`);
}

/** 백그라운드 질문 생성 실패 시 재시도 (SSE error 이벤트의 복구 경로). */
export function retryRound(sessionId: string): Promise<{ accepted: boolean }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/rounds`, { method: 'POST' });
}
