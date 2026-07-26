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
    slotStates: Array<{
      slotKey: string;
      state: string;
      value: unknown;
      confirmedByRequester: boolean;
      openIssueAssignee: string | null;
    }>;
    signals: Array<{
      type: string;
      payload: unknown;
      occurredAt: string;
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
  };

  const sessions = exported.map(({ session, requesters, utterances, slotStates, signals }) => {
    count(summary.statusCounts, session.status);
    if (session.terminalState) count(summary.terminalCounts, session.terminalState);
    count(summary.channelCounts, session.originChannel);
    for (const slot of slotStates) {
      summary.slotStateCounts[slot.state as keyof TraceSummary['slotStateCounts']] += 1;
    }
    for (const signal of signals) count(summary.signalTypeCounts, signal.type);

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
      slotStates: slotStates.map((slot) => ({
        slotKey: slot.slotKey,
        state: slot.state,
        value: slot.value,
        confirmedByRequester: slot.confirmedByRequester,
        openIssueAssignee: slot.openIssueAssignee,
      })),
      signals: signals.map((signal) => ({
        type: signal.type,
        payload: signal.payload,
        occurredAt: signal.occurredAt,
      })),
    };
  });

  if (sessions.length > 0) {
    const total = sessions.reduce((sum, s) => sum + s.roundCount, 0);
    summary.avgRoundCount = Math.round((total / sessions.length) * 100) / 100;
  }

  return { generatedAt, summary, sessions };
}
