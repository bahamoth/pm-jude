import type { LlmBackend } from '../gateway/backend';
import { LlmGateway, type UsageLogger } from '../gateway/gateway';
import { CLARIFICATION_V0, COMPLETENESS_V0, REQUIREMENTS_V0 } from '../prompts/catalog';
import type { ClarificationOutput } from '../prompts/clarification-v0';
import {
  judgeCompleteness,
  runRuleLayer,
  type CompletenessOutput,
} from '../prompts/completeness-v0';
import {
  assembleRequirementsDocument,
  type RequirementsDocument,
  type RequirementsOutput,
} from '../prompts/requirements-v0';
import type { PromptRegistry } from '../prompts/registry';
import type { SessionStore } from '../store/session-store';
import { ensureVersionAxes, TEMP_REQUIRED_SLOTS } from './local-runner';

export interface SlackPostedMessage {
  channel: string;
  threadTs: string;
  text: string;
}

/** 코어가 아는 Slack의 전부 — Bolt 앱은 이 포트의 얇은 어댑터다 (채널 어댑터 원칙). */
export interface SlackPort {
  postMessage(input: SlackPostedMessage): Promise<void>;
}

export interface SlackThreadEvent {
  channel: string;
  threadTs: string;
  userId: string;
  text: string;
}

/**
 * 요청자 언어 감지 초안 — 프로필 선호 언어(F1-Core)는 Phase 1 몫이라 PoC에서는
 * 발화 문자로 추정한다. 팀이 한국어·영어권 혼성이라는 전제(F2d)의 최소 구현.
 */
export function detectRequesterLanguage(text: string): 'ko' | 'en' {
  return /[가-힣]/.test(text) ? 'ko' : 'en';
}

const MESSAGES = {
  ko: {
    ack: '접수했습니다 — 요청을 정리하기 위해 몇 가지만 여쭤볼게요.',
    questionsHeader: '몇 가지 확인이 필요해요:',
    dontKnowHint: '각 질문에 답하기 어려우면 그대로 알려주세요',
    onHold:
      '이번 요청은 정보가 부족해 보류(정보 부족)로 종결합니다. 내용을 보태 다시 멘션하시면 언제든 재개할 수 있어요.',
  },
  en: {
    ack: 'Got it — let me ask a few questions to pin down the request.',
    questionsHeader: 'A few things to confirm:',
    dontKnowHint: 'If you cannot answer a question, just say so',
    onHold:
      'This request is being closed as on-hold (insufficient info). Mention me again with more detail to resume anytime.',
  },
} as const;

export interface SlackRunnerDeps {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  slack: SlackPort;
  usageLogger?: UsageLogger;
  /** 팀 표준 문서 언어 (F2d). 기본 ko. */
  teamLanguage?: string;
  /** 명확화 왕복 상한 — 수치는 PoC 중 확정 (PRD §12). 기본 3. */
  maxRounds?: number;
}

function threadKeyOf(event: { channel: string; threadTs: string }): string {
  return `slack:${event.channel}:${event.threadTs}`;
}

function formatQuestions(output: ClarificationOutput, language: 'ko' | 'en'): string {
  const t = MESSAGES[language];
  const lines: string[] = [t.questionsHeader];
  output.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.question}`);
    lines.push(`   (${question.exampleOptions.join(' / ')})`);
  });
  const dontKnow = output.questions[0]?.dontKnowPath.label;
  if (dontKnow) lines.push(`_${t.dontKnowHint}: 「${dontKnow}」_`);
  return lines.join('\n');
}

function formatDocument(doc: RequirementsDocument): string {
  const { content } = doc;
  const lines = [
    '*requirements v0*',
    `*문제* — ${content.problem}`,
    `*사용자* — ${content.users.join(', ')}`,
    `*스코프* — 포함: ${content.scope.inScope.join(', ')}` +
      (content.scope.outOfScope.length ? ` / 제외: ${content.scope.outOfScope.join(', ')}` : ''),
    '*유저스토리·수용기준*',
  ];
  for (const story of content.stories) {
    lines.push(`• ${story.story}`);
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`   - ${criterion.ears}`);
      lines.push(
        `     Given ${criterion.gwt.given} / When ${criterion.gwt.when} / Then ${criterion.gwt.then}`,
      );
    }
  }
  lines.push(`*데이터 소스* — ${content.dataSources.join(', ') || '미확정 (오픈이슈 참조)'}`);
  if (content.openIssues.length) {
    lines.push('*오픈이슈* (요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)');
    for (const issue of content.openIssues) {
      lines.push(`• [${issue.slotKey}] ${issue.question} — 담당: ${issue.assignee ?? '미지정'}`);
    }
  }
  lines.push(`_원문 전사 ${String(doc.originalTranscript.length)}건 보존됨 (세션 저장소)_`);
  return lines.join('\n');
}

/**
 * Slack PoC 러너 코어 (#8) — 멘션 인테이크 → 접수 확인 → 스레드 명확화 → 완결 시 문서 게시.
 * 단계 전이는 이 코드가 결정하고 LLM은 구조화 호출 3종(질문 생성·완결성 판정·문서 생성)으로만
 * 존재한다 (고정 오케스트레이션, ADR-0001). Linear 연동은 없다 — 문서 게시까지가 PoC 범위.
 */
export class SlackIntakeRunner {
  private readonly gateway: LlmGateway;
  private readonly teamLanguage: string;
  private readonly maxRounds: number;

  constructor(private readonly deps: SlackRunnerDeps) {
    this.gateway = new LlmGateway({
      backend: deps.backend,
      registry: deps.registry,
      ...(deps.usageLogger ? { usageLogger: deps.usageLogger } : {}),
    });
    this.teamLanguage = deps.teamLanguage ?? 'ko';
    this.maxRounds = deps.maxRounds ?? 3;
  }

  async handleMention(event: SlackThreadEvent): Promise<void> {
    const { store, registry } = this.deps;
    if (store.findSessionByThreadKey(threadKeyOf(event))) {
      // 같은 스레드의 재멘션은 새 세션이 아니라 진행 중 세션의 답변이다
      await this.handleThreadReply(event);
      return;
    }

    const versionAxes = ensureVersionAxes(store, registry);
    const session = store.createSession({
      originChannel: 'slack',
      channelThreadKey: threadKeyOf(event),
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
    const language = detectRequesterLanguage(event.text);
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      authorId: event.userId,
      channel: 'slack',
      originalText: event.text,
      originalLanguage: language,
    });
    // 접수 확인은 LLM 호출보다 먼저 나간다 (F1 수용기준 — 즉시 확인 응답)
    await this.post(event, MESSAGES[language].ack);
    await this.runClarificationRound(session.id, event, language);
  }

  async handleThreadReply(event: SlackThreadEvent): Promise<void> {
    const { store } = this.deps;
    const session = store.findSessionByThreadKey(threadKeyOf(event));
    if (!session || session.status === 'documented' || session.status === 'closed') return;

    const language = detectRequesterLanguage(event.text);
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      authorId: event.userId,
      channel: 'slack',
      originalText: event.text,
      originalLanguage: language,
    });

    const versionAxes = this.versionAxesOf(session);
    const { request, conversation } = this.buildConversation(session.id);
    const completeness = await this.gateway.complete<CompletenessOutput>(COMPLETENESS_V0, {
      request,
      teamLanguage: this.teamLanguage,
      requiredSlots: TEMP_REQUIRED_SLOTS,
      conversation,
    });

    // LLM 슬롯 판정을 세션 슬롯 상태로 반영 — 승격 트리거 (F2c, US-10)
    for (const slot of completeness.output.slots) {
      store.setSlotState({ sessionId: session.id, slotKey: slot.slotKey, state: slot.verdict });
    }
    const rule = runRuleLayer({
      requiredSlots: TEMP_REQUIRED_SLOTS,
      slotStates: store.listSlotStates(session.id),
    });
    const verdict = judgeCompleteness({ rule, llm: completeness.output });
    store.recordSignal({
      sessionId: session.id,
      type: 'completeness_check',
      payload: {
        refined: verdict.refined,
        llmScore: verdict.llmScore,
        ruleFailures: verdict.rule.failures,
        llmUnfilledSlotKeys: verdict.llmUnfilledSlotKeys,
      },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });

    if (verdict.refined) {
      await this.deliverDocument(session.id, event, completeness.output, request, conversation);
      return;
    }
    if (session.roundCount < this.maxRounds) {
      await this.runClarificationRound(session.id, event, language);
      return;
    }
    // 상한 도달 + 승격조차 불가 — 사유 회신 후 보류(정보 부족) 종결 (원칙 5: 회신이 종결을 앞선다)
    await this.post(event, MESSAGES[language].onHold);
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'agent',
      channel: 'slack',
      originalText: MESSAGES[language].onHold,
      originalLanguage: language,
    });
    store.updateSessionState(session.id, {
      status: 'closed',
      terminalState: 'on_hold_insufficient_info',
    });
    store.recordSignal({
      sessionId: session.id,
      type: 'session_on_hold',
      payload: { reason: 'insufficient_info', roundCount: session.roundCount },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
  }

  private async runClarificationRound(
    sessionId: string,
    event: SlackThreadEvent,
    language: 'ko' | 'en',
  ): Promise<void> {
    const { store } = this.deps;
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`세션 조회 실패: ${sessionId}`);
    const versionAxes = this.versionAxesOf(session);
    const { request } = this.buildConversation(sessionId);

    const stateBySlot = new Map(
      store.listSlotStates(sessionId).map((slot) => [slot.slotKey, slot.state]),
    );
    const result = await this.gateway.complete<ClarificationOutput>(CLARIFICATION_V0, {
      request,
      requesterLanguage: language,
      requiredSlots: TEMP_REQUIRED_SLOTS.map((slot) => ({
        ...slot,
        state: stateBySlot.get(slot.key) === 'filled' ? 'filled' : 'unfilled',
      })),
    });

    for (const question of result.output.questions) {
      if (question.target.type === 'slot' && !stateBySlot.has(question.target.slotKey)) {
        store.setSlotState({
          sessionId,
          slotKey: question.target.slotKey,
          state: 'unfilled',
        });
      }
    }
    const text = formatQuestions(result.output, language);
    await this.post(event, text);
    store.appendUtterance({
      sessionId,
      authorType: 'agent',
      channel: 'slack',
      originalText: text,
      originalLanguage: language,
    });
    store.recordSignal({
      sessionId,
      type: 'clarification_round',
      payload: { round: session.roundCount + 1, questionCount: result.output.questions.length },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
    store.updateSessionState(sessionId, {
      status: 'clarifying',
      roundCount: session.roundCount + 1,
    });
  }

  private async deliverDocument(
    sessionId: string,
    event: SlackThreadEvent,
    completeness: CompletenessOutput,
    request: string,
    conversation: Array<{ question: string; answer: string }>,
  ): Promise<void> {
    const { store } = this.deps;
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`세션 조회 실패: ${sessionId}`);
    const versionAxes = this.versionAxesOf(session);

    const rationaleBySlot = new Map(
      completeness.slots.map((slot) => [slot.slotKey, slot.rationale]),
    );
    const promotedSlots = store
      .listSlotStates(sessionId)
      .filter((slot) => slot.state === 'promoted')
      .map((slot) => ({
        slotKey: slot.slotKey,
        openIssueAssignee: slot.openIssueAssignee,
        question: rationaleBySlot.get(slot.slotKey) ?? `${slot.slotKey} 확정 필요`,
      }));

    const result = await this.gateway.complete<RequirementsOutput>(REQUIREMENTS_V0, {
      request,
      teamLanguage: this.teamLanguage,
      clarifications: conversation,
      promotedSlots: promotedSlots.map(({ slotKey, question }) => ({ key: slotKey, question })),
    });
    const doc = assembleRequirementsDocument({
      output: result.output,
      promotedSlots,
      utterances: store.listUtterances(sessionId).map((utterance) => ({
        seq: utterance.seq,
        authorType: utterance.authorType,
        originalText: utterance.originalText,
        originalLanguage: utterance.originalLanguage,
      })),
    });

    const text = formatDocument(doc);
    await this.post(event, text);
    store.appendUtterance({
      sessionId,
      authorType: 'agent',
      channel: 'slack',
      originalText: text,
      originalLanguage: this.teamLanguage,
    });
    store.updateSessionState(sessionId, { status: 'documented' });
    store.recordSignal({
      sessionId,
      type: 'document_delivered',
      payload: { openIssueCount: doc.content.openIssues.length },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
  }

  /** 세션 행에 고정된 버전 축을 신호 기록용으로 되돌린다 (F11 — 세션 생성 시점 버전 귀속). */
  private versionAxesOf(session: {
    promptVersionId: string;
    thresholdVersionId: string;
    slotSchemaVersionId: string;
  }) {
    return {
      promptVersionId: session.promptVersionId,
      thresholdVersionId: session.thresholdVersionId,
      slotSchemaVersionId: session.slotSchemaVersionId,
    };
  }

  /** 전사에서 요청 원문과 Q/A 쌍을 조립한다 — 게이트웨이 호출은 무상태이므로 매번 저장소에서 만든다 (F14). */
  private buildConversation(sessionId: string): {
    request: string;
    conversation: Array<{ question: string; answer: string }>;
  } {
    const utterances = this.deps.store.listUtterances(sessionId);
    const request = utterances.find((u) => u.authorType === 'requester')?.originalText ?? '';
    const conversation: Array<{ question: string; answer: string }> = [];
    let pendingQuestion: string | null = null;
    for (const utterance of utterances) {
      if (utterance.authorType === 'agent') {
        pendingQuestion = utterance.originalText;
      } else if (pendingQuestion !== null) {
        conversation.push({ question: pendingQuestion, answer: utterance.originalText });
        pendingQuestion = null;
      }
    }
    return { request, conversation };
  }

  private post(event: SlackThreadEvent, text: string): Promise<void> {
    return this.deps.slack.postMessage({
      channel: event.channel,
      threadTs: event.threadTs,
      text,
    });
  }
}
