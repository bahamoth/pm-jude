import { ApiError, type RoundResult, type SessionDetail } from './types';

// /api는 next.config 프록시로 API 서버(pnpm web)에 닿는다 (ADR-0008).

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
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
