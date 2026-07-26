import { ApiError, type RoundResult, type SessionDetail } from './types';

// /api는 next.config 프록시로 API 서버(pnpm web)에 닿는다 (ADR-0008).

// 게이트웨이 LLM 타임아웃(기본 120초)보다 여유를 두고 끊는다 — 무한 대기 방지(요구 4).
const REQUEST_TIMEOUT_MS = 150_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(
        0,
        '응답이 늦어지고 있어요 — 「이어서 진행」으로 세션을 다시 불러올 수 있어요.',
      );
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
}): Promise<RoundResult> {
  return request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function sendReply(sessionId: string, text: string): Promise<RoundResult> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}`);
}
