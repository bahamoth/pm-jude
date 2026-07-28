import type { SessionStore } from '../store/session-store';

// 트레이스 뷰어의 데이터 조형 — SessionStore.exportSessions()의 얇은 소비자.
// DB 접근 없이 순수 함수로 유지한다 (테스트 심).

type ExportedSessions = ReturnType<SessionStore['exportSessions']>;
type VersionRegistry = ReturnType<SessionStore['listVersionRegistry']>;

export interface TraceSummary {
  sessionCount: number;
  statusCounts: Record<string, number>;
  terminalCounts: Record<string, number>;
  channelCounts: Record<string, number>;
  avgRoundCount: number | null;
  slotStateCounts: Record<'filled' | 'unfilled' | 'promoted', number>;
  signalTypeCounts: Record<string, number>;
  /** 첨부 추출 현황 (F1-Attach) — 실패가 쌓이면 추출기를 고칠 신호다 (F13). */
  attachmentCounts: Record<'total' | 'ok' | 'failed' | 'pending', number>;
  /** 영속된 requirements 문서 버전 수 (#53) — 정정 재생성이 쌓이면 버전이 는다 (G-11). */
  documentCount: number;
  /** 목업 반복 현황 (F4 #54) — 반복·어노테이션 밀도는 명확화 수렴 품질의 신호다 (F11). */
  mockupCounts: Record<'versions' | 'annotations', number>;
}

export interface TraceData {
  generatedAt: string;
  summary: TraceSummary;
  sessions: Array<{
    id: string;
    status: string;
    terminalState: string | null;
    originChannel: string;
    isUiRequest: boolean | null;
    roundCount: number;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    /** 버전 귀속 5축 — id를 name@semver로 해석한 표기 (미등록 id는 원문 유지). */
    versions: {
      prompt: string;
      model: string;
      threshold: string;
      slotSchema: string;
    };
    requesters: Array<{
      role: string;
      subscribed: boolean;
      preferredLanguage: string;
      timezone: string;
    }>;
    utterances: Array<{
      seq: number;
      authorType: string;
      channel: string;
      originalText: string;
      originalLanguage: string;
      normalizedText: string | null;
      createdAt: string;
    }>;
    /** 첨부와 추출 결과 (F1-Attach) — 원본 주소·파일명은 export 단계에서 이미 빠져 있다. */
    attachments: Array<{
      utteranceSeq: number | null;
      mime: string;
      bytes: number;
      extractedText: string | null;
      extractionStatus: string;
      extractionError: string | null;
      extractorVersion: string | null;
      createdAt: string;
    }>;
    slotStates: Array<{
      slotKey: string;
      state: string;
      value: unknown;
      confirmedByRequester: boolean;
      /** 값이 첨부에서 왔는가 — 추출 결함과 프롬프트 결함을 가르는 판독 근거 (F13). */
      evidenceAttachmentId: string | null;
      openIssueAssignee: string | null;
    }>;
    signals: Array<{
      type: string;
      payload: unknown;
      occurredAt: string;
    }>;
    /** 영속된 문서 버전 (#53) — 게시 텍스트가 아니라 정본 구조체. */
    documents: Array<{
      version: number;
      content: unknown;
      backInjectedFrom: string | null;
      createdAt: string;
    }>;
    /** 목업 버전 궤적 (F4 #54) — HTML 원문 없이 크기만 (개발팀 전달 금지 하드 제약과 정합). */
    mockups: Array<{
      version: number;
      docVersion: number;
      summary: string | null;
      convergence: string;
      selectedTheme: string | null;
      themeDelegated: boolean;
      htmlBytes: number;
      createdAt: string;
    }>;
    mockupAnnotations: Array<{
      mockupVersion: number | null;
      text: string;
      elementRef: string | null;
      createdAt: string;
    }>;
  }>;
}

function count(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildTraceData(
  exported: ExportedSessions,
  registry: VersionRegistry,
  generatedAt: string,
): TraceData {
  const label = (entries: VersionRegistry['prompt'], id: string): string => {
    const found = entries.find((entry) => entry.id === id);
    return found ? `${found.name}@${found.semver}` : id;
  };

  const summary: TraceSummary = {
    sessionCount: exported.length,
    statusCounts: {},
    terminalCounts: {},
    channelCounts: {},
    avgRoundCount: null,
    slotStateCounts: { filled: 0, unfilled: 0, promoted: 0 },
    signalTypeCounts: {},
    attachmentCounts: { total: 0, ok: 0, failed: 0, pending: 0 },
    documentCount: 0,
    mockupCounts: { versions: 0, annotations: 0 },
  };

  const sessions = exported.map(
    ({
      session,
      requesters,
      utterances,
      attachments,
      slotStates,
      signals,
      documents,
      mockups,
      mockupAnnotations,
    }) => {
      count(summary.statusCounts, session.status);
      if (session.terminalState) count(summary.terminalCounts, session.terminalState);
      count(summary.channelCounts, session.originChannel);
      for (const slot of slotStates) {
        summary.slotStateCounts[slot.state as keyof TraceSummary['slotStateCounts']] += 1;
      }
      for (const signal of signals) count(summary.signalTypeCounts, signal.type);
      for (const attachment of attachments) {
        summary.attachmentCounts.total += 1;
        count(summary.attachmentCounts, attachment.extractionStatus);
      }
      summary.documentCount += documents.length;
      summary.mockupCounts.versions += mockups.length;
      summary.mockupCounts.annotations += mockupAnnotations.length;

      return {
        id: session.id,
        status: session.status,
        terminalState: session.terminalState,
        originChannel: session.originChannel,
        isUiRequest: session.isUiRequest,
        roundCount: session.roundCount,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        closedAt: session.closedAt,
        versions: {
          prompt: label(registry.prompt, session.promptVersionId),
          model: session.modelVersion,
          threshold: label(registry.threshold, session.thresholdVersionId),
          slotSchema: label(registry.slotSchema, session.slotSchemaVersionId),
        },
        requesters,
        utterances: utterances.map((utterance) => ({
          seq: utterance.seq,
          authorType: utterance.authorType,
          channel: utterance.channel,
          originalText: utterance.originalText,
          originalLanguage: utterance.originalLanguage,
          normalizedText: utterance.normalizedText,
          createdAt: utterance.createdAt,
        })),
        attachments,
        slotStates: slotStates.map((slot) => ({
          slotKey: slot.slotKey,
          state: slot.state,
          value: slot.value,
          confirmedByRequester: slot.confirmedByRequester,
          evidenceAttachmentId: slot.evidenceAttachmentId,
          openIssueAssignee: slot.openIssueAssignee,
        })),
        signals: signals.map((signal) => ({
          type: signal.type,
          payload: signal.payload,
          occurredAt: signal.occurredAt,
        })),
        documents,
        mockups,
        mockupAnnotations,
      };
    },
  );

  if (sessions.length > 0) {
    const total = sessions.reduce((sum, s) => sum + s.roundCount, 0);
    summary.avgRoundCount = Math.round((total / sessions.length) * 100) / 100;
  }

  return { generatedAt, summary, sessions };
}
