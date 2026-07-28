import {
  ApiError,
  type Accepted,
  type IntakeResult,
  type MockupState,
  type ReplyOutcome,
  type SessionDetail,
  type SessionSummary,
  type UploadedFile,
  type UploadPolicy,
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
    const fields =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const message = 'error' in fields ? String(fields.error) : `요청 실패 (${res.status})`;
    const code = typeof fields.code === 'string' ? fields.code : undefined;
    throw new ApiError(res.status, message, code);
  }
  return body as T;
}

/**
 * 자료 하나를 스테이징에 올린다 (F1-Attach, ADR-0011 결정 10) — 아직 발화에 붙지 않는다.
 * 검증은 서버가 즉시 하고 거부 사유를 그대로 돌려준다: 제출 후에 실패를 알게 하지 않는다(P-U1).
 * multipart 대신 raw body라 파일 하나가 요청 하나이고, 그래서 거부도 파일별로 나뉜다.
 */
export function uploadFile(file: File): Promise<UploadedFile> {
  return request('/api/uploads', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
}

/** 세션이 아직 없는 화면(인테이크 폼)이 업로드 표면을 열지 판단하는 근거. */
export function getUploadPolicy(): Promise<UploadPolicy> {
  return request('/api/uploads');
}

/** 세션 스코프 다운로드 경로 — 서버가 인라인 렌더를 막고 내려주기만 한다 (결정 13). */
export function attachmentUrl(sessionId: string, attachmentId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function startSession(input: {
  name?: string;
  language: 'ko' | 'en';
  text: string;
  uploadIds?: string[];
}): Promise<IntakeResult> {
  return request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/**
 * 202 접수 — 판정·다음 라운드·문서는 백그라운드에서 돌고 SSE·조회로 온다.
 * roundId는 답이 응답하는 라운드다(G-10) — 다른 탭이 이미 라운드를 넘겼으면 서버가 409로 막는다.
 * 보류 재개 입력에는 답할 라운드가 없어 생략한다.
 */
export function sendReply(
  sessionId: string,
  text: string,
  roundId?: string | null,
  uploadIds?: string[],
): Promise<Accepted> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(roundId ? { roundId } : {}),
      ...(uploadIds?.length ? { uploadIds } : {}),
    }),
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
export function correctSlot(
  sessionId: string,
  slotKey: string,
  text: string,
  uploadIds?: string[],
): Promise<Accepted> {
  return request(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/${encodeURIComponent(slotKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmed: false,
        text,
        ...(uploadIds?.length ? { uploadIds } : {}),
      }),
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

// ── 목업 반복·디자인 시스템 선정 (F4, #54) ──────────────────────────────

/** 목업 반복 상태 — 버전·예산·테마 후보·어노테이션 (화면 복원의 근거). */
export function getMockupState(sessionId: string): Promise<MockupState> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/mockup`);
}

/** 목업 서빙 주소 — 샌드박스 iframe의 src. theme은 선정 전 미리보기용. */
export function mockupUrl(sessionId: string, version: number, theme?: string | null): string {
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/mockups/${String(version)}`;
  return theme ? `${base}?theme=${encodeURIComponent(theme)}` : base;
}

/** 코멘트 202 접수 — 재생성은 백그라운드. mockupVersion이 최신이 아니면 서버가 409로 막는다. */
export function sendMockupComments(
  sessionId: string,
  mockupVersion: number,
  comments: Array<{ text: string; elementRef?: string }>,
): Promise<Accepted> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/mockup/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mockupVersion, comments }),
  });
}

/** 디자인 시스템 선정(동기 200) — LLM 호출이 없다. 다시 고르면 덮어쓴다. */
export function selectMockupTheme(
  sessionId: string,
  selection: { themeId: string } | { delegated: true },
): Promise<ReplyOutcome> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/mockup/theme`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection),
  });
}

/** 최종 승인 202 — 역주입(문서 vN+1)이 백그라운드로 돈다. 테마 미결정이면 409. */
export function approveMockup(sessionId: string): Promise<Accepted> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/mockup/approval`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}
