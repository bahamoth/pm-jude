// API 서버(src/web/server.ts)의 HTTP 계약과 1:1 — 서버가 진실 원천이다.

export interface ReplyQuestion {
  index: number;
  question: string;
  exampleOptions: string[];
  dontKnowLabel: string;
}

export interface Reply {
  text: string;
  questions?: ReplyQuestion[];
}

/** 코어 러너가 세션에 부여하는 상태 집합 (src/runner/core-runner.ts). */
export type SessionStatus = 'intake' | 'clarifying' | 'documented' | 'closed';

/** 재시도할 미완 라운드의 종류 — 질문 생성이 죽었는지, 판정이 죽었는지 (G-10). */
export type PendingRound = 'clarification' | 'judgement' | null;

/** 접수 응답 — 즉시 반환(F1). 질문은 SSE·세션 조회로 온다. */
export interface IntakeResult {
  sessionId: string;
  status: SessionStatus;
  terminalState: string | null;
  ack: string;
}

/** 202 접수 응답 — 처리 결과는 SSE·세션 조회로 온다 (#31). */
export interface Accepted {
  sessionId: string;
  accepted: boolean;
}

export interface ReplyOutcome {
  sessionId: string;
  status: SessionStatus;
  terminalState: string | null;
}

export interface Utterance {
  seq: number;
  authorType: 'requester' | 'agent' | 'approver';
  originalText: string;
  originalLanguage: string;
  createdAt: string;
}

export interface SlotView {
  slotKey: string;
  label: string;
  state: 'filled' | 'unfilled' | 'promoted' | string;
  value: string | null;
  confirmedByRequester: boolean;
  openIssueAssignee: string | null;
}

export interface SessionDetail {
  latestQuestions: ReplyQuestion[] | null;
  /** 최신 명확화 라운드의 식별자 — 답변 제출이 동반해야 한다 (G-10 라운드 정합). */
  roundId: string | null;
  /** 죽은 채 남은 라운드 — 재시도 CTA의 근거. 판정은 서버가 한다 (G-10). */
  pendingRound: PendingRound;
  /** 지금까지 게시된 requirements 문서 수 = 현재 문서의 vN. 문서 전이면 0 (G-11). */
  documentVersion: number;
  /** 현재 문서 버전에서 전 슬롯 확인이 끝났는가 — Phase 0 종착 (G-11). */
  completed: boolean;
  roundBudget: number;
  /** 서버가 이 세션의 LLM 라운드를 돌리는 중인지 — 대기 화면과 SSE 수명의 근거 */
  processing: boolean;
  session: {
    id: string;
    status: SessionStatus;
    terminalState: string | null;
    roundCount: number;
    originChannel: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  };
  utterances: Utterance[];
  slotStates: SlotView[];
}

export interface SessionSummary {
  id: string;
  status: SessionStatus;
  terminalState: string | null;
  roundCount: number;
  requestText: string;
  updatedAt: string;
  openIssueCount: number;
}

/** SSE status 이벤트 페이로드 — processing=false가 라운드 완료(연결 종료) 신호다. */
export interface StatusEvent {
  sessionId: string;
  status: SessionStatus;
  terminalState: string | null;
  roundCount: number;
  roundBudget: number;
  processing: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 서버가 붙인 사유 코드 — `stale_round` 등 화면이 분기하는 계약 위반 (G-10). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
