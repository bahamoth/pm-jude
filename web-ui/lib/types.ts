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
export type SessionStatus = 'intake' | 'clarifying' | 'documented' | 'mockup' | 'closed';

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
  /** 값이 첨부에서 왔다면 그 첨부 — 화면이 출처를 표시한다 (F2c, ADR-0011 결정 8). */
  evidenceAttachmentId: string | null;
  openIssueAssignee: string | null;
}

/** 세션에 붙은 자료 (F1-Attach). 추출 텍스트는 오지 않는다 — 내용은 원본 다운로드로 본다. */
export interface AttachmentView {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  extractionStatus: 'pending' | 'ok' | 'failed' | string;
  extractionError: string | null;
}

/** 업로드 표면을 열지·무엇을 고지할지의 근거. */
export type UploadPolicy =
  | { enabled: false }
  | {
      enabled: true;
      supportedMimes: string[];
      maxBytesPerFile: number;
      maxPerSession: number;
    };

/** 업로드 응답 — 아직 발화에 붙지 않은 스테이징 상태다 (ADR-0011 결정 10). */
export interface UploadedFile {
  uploadId: string;
  filename: string;
  mime: string;
  bytes: number;
}

/** requirements 문서 구조체 — 서버 requirements_doc.content의 뷰 타입 (#53, data-model.md). */
export interface DocumentContent {
  problem: string;
  users: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  stories: Array<{
    story: string;
    acceptanceCriteria: Array<{
      ears: string;
      gwt: { given: string; when: string; then: string };
    }>;
  }>;
  dataSources: string[];
  openIssues: Array<{ slotKey: string; question: string; assignee: string | null }>;
}

/** 목업 요약 (F4 #54) — 세션 조회에 실린다. 상세는 목업 상태 조회로. */
export interface MockupSummary {
  latestVersion: number;
  docVersion: number;
  convergence: 'iterating' | 'approved' | 'escalated' | string;
  selectedTheme: string | null;
  themeDelegated: boolean;
}

/** 디자인 시스템 선정 후보 — 테마 레지스트리(내장 + 외부 등록)에서 온다 (F4). */
export interface ThemeCandidate {
  id: string;
  name: string;
  description: string;
}

/** 목업 반복 상태 (GET /api/sessions/:id/mockup) — 화면 복원의 근거. */
export interface MockupState extends MockupSummary {
  iterationsUsed: number;
  iterationBudget: number;
  versions: Array<{
    version: number;
    docVersion: number;
    summary: string | null;
    createdAt: string;
  }>;
  themes: ThemeCandidate[];
  annotations: Array<{
    mockupVersion: number | null;
    text: string;
    elementRef: string | null;
    createdAt: string;
  }>;
  processing: boolean;
}

export interface SessionDetail {
  latestQuestions: ReplyQuestion[] | null;
  /** 최신 명확화 라운드의 식별자 — 답변 제출이 동반해야 한다 (G-10 라운드 정합). */
  roundId: string | null;
  /** 죽은 채 남은 라운드 — 재시도 CTA의 근거. 판정은 서버가 한다 (G-10). */
  pendingRound: PendingRound;
  /** 지금까지 게시된 requirements 문서 수 = 현재 문서의 vN. 문서 전이면 0 (G-11). */
  documentVersion: number;
  /** 최신 문서의 정본 구조체 (#53) — null이면 레거시 세션, 발화 텍스트 파서로 폴백. */
  document: { version: number; content: DocumentContent } | null;
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
  /** 올린 자료와 읽힘 여부 — 읽지 못한 자료도 사유와 함께 남는다 (F1-Attach). */
  attachments: AttachmentView[];
  uploads: UploadPolicy;
  /** 목업 요약 (F4 #54) — null이면 목업 없는 세션 (비 UI 또는 목업 전). */
  mockup: MockupSummary | null;
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
