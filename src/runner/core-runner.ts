import type { LlmBackend } from '../gateway/backend';
import { LlmGateway, type UsageLogger } from '../gateway/gateway';
import { CLARIFICATION_V0, COMPLETENESS_V0, REQUIREMENTS_V0 } from '../prompts/catalog';
import type { ClarificationOutput } from '../prompts/clarification-v0';
import {
  COMPLETENESS_RUBRIC_V0,
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

/**
 * #10(필수 슬롯 초안, ←#9 소급 분석) 전까지 개발용으로 쓰는 임시 슬롯 목록.
 * 근거 있는 목록이 나오면 slot_schema_version을 올리고 이 상수를 교체한다 (F2e).
 */
export const TEMP_REQUIRED_SLOTS = [
  { key: 'target-user', label: '대상 사용자' },
  { key: 'purpose', label: '해결하려는 문제' },
  { key: 'data-source', label: '데이터 소스' },
] as const;

/** 카탈로그의 프롬프트 버전과 임시 임계치·슬롯 스키마를 DB 버전 레지스트리에 아이덤포턴트하게 동기화한다. */
export function ensureVersionAxes(store: SessionStore, registry: PromptRegistry) {
  const clarification = registry.get(CLARIFICATION_V0);
  const promptVersionId =
    store.findVersionId('prompt', clarification.name, clarification.semver) ??
    store.registerPromptVersion({
      name: clarification.name,
      semver: clarification.semver,
      bodyRef: 'src/prompts/clarification-v0.ts',
      regressionPassed: clarification.regressionPassed,
    });
  const thresholdVersionId =
    store.findVersionId('threshold', COMPLETENESS_RUBRIC_V0.name, COMPLETENESS_RUBRIC_V0.semver) ??
    store.registerThresholdVersion({
      name: COMPLETENESS_RUBRIC_V0.name,
      semver: COMPLETENESS_RUBRIC_V0.semver,
      bodyRef: 'src/prompts/completeness-v0.ts',
      regressionPassed: false,
    });
  const slotSchemaVersionId =
    store.findVersionId('slot_schema', 'temp-required-slots', '0.0.0') ??
    store.registerSlotSchemaVersion({
      name: 'temp-required-slots',
      semver: '0.0.0',
      bodyRef: 'src/runner/core-runner.ts',
      regressionPassed: false,
      slots: TEMP_REQUIRED_SLOTS,
      derivedFrom: [], // 임시 목록 — 실측 근거는 #10에서 합류
    });
  return { promptVersionId, thresholdVersionId, slotSchemaVersionId };
}

/**
 * 명확화 라운드의 구조화 페이로드 — 질문별 UI(「모르겠다」 1클릭, US-5)나 CLI 렌더링처럼
 * 텍스트만으로 부족한 어댑터가 소비한다. 텍스트 회신은 항상 동봉되므로 무시해도 동작한다.
 */
export interface ClarificationRoundPayload {
  kind: 'clarification_questions';
  interpretations: string[];
  questions: ClarificationOutput['questions'];
}

/**
 * 코어가 아는 채널의 전부 — 회신 게시용 포트 (채널 어댑터 원칙, ADR-0007).
 * 주소 A는 코어가 해석하지 않고 이벤트에서 포트로 흘려보낸다.
 * 웹·CLI·Slack 어댑터가 각자 구현한다 (SlackPort와 대칭).
 */
export interface ChannelPort<A> {
  post(address: A, text: string, payload?: ClarificationRoundPayload): Promise<void>;
}

export interface IntakeEvent<A> {
  /** 회신 주소 — 포트만 해석한다. */
  address: A;
  /** 채널 스레드 ↔ 세션 영속 매핑 키 (예: `slack:<channel>:<thread_ts>`, `web:<uuid>`). */
  threadKey: string;
  channel: 'web' | 'slack';
  authorId?: string;
  text: string;
  /** 명시 요청자 언어 (웹 간이 식별). 없으면 발화 문자로 감지한다. */
  language?: 'ko' | 'en';
}

export interface ReplyOutcome {
  sessionId: string;
  status: string;
  terminalState: string | null;
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
      '이번 요청은 정보가 부족해 보류(정보 부족)로 종결합니다. 내용을 보태 다시 요청을 이어가시면 언제든 재개할 수 있어요.',
  },
  en: {
    ack: 'Got it — let me ask a few questions to pin down the request.',
    questionsHeader: 'A few things to confirm:',
    dontKnowHint: 'If you cannot answer a question, just say so',
    onHold:
      'This request is being closed as on-hold (insufficient info). Come back with more detail to resume anytime.',
  },
} as const;

export interface IntakeRunnerDeps<A> {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  port: ChannelPort<A>;
  usageLogger?: UsageLogger;
  /** 팀 표준 문서 언어 (F2d). 기본 ko. */
  teamLanguage?: string;
  /** 명확화 왕복 상한 — 수치는 PoC 중 확정 (PRD §12). 기본 3. */
  maxRounds?: number;
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
 * 채널 비의존 코어 러너 (#16, ADR-0007) — 인테이크 → 접수 확인 → 명확화 루프 →
 * 2층 완결성 판정 → 정제 완료 시 requirements 문서 게시.
 * 단계 전이는 이 코드가 결정하고 LLM은 구조화 호출 3종(질문 생성·완결성 판정·문서 생성)으로만
 * 존재한다 (고정 오케스트레이션, ADR-0001). Linear 연동은 없다 — 문서 게시까지가 PoC 범위.
 */
export class IntakeRunner<A> {
  private readonly gateway: LlmGateway;
  private readonly teamLanguage: string;
  private readonly maxRounds: number;

  constructor(private readonly deps: IntakeRunnerDeps<A>) {
    this.gateway = new LlmGateway({
      backend: deps.backend,
      registry: deps.registry,
      ...(deps.usageLogger ? { usageLogger: deps.usageLogger } : {}),
    });
    this.teamLanguage = deps.teamLanguage ?? 'ko';
    this.maxRounds = deps.maxRounds ?? 3;
  }

  /**
   * 세션 개설만 수행한다 — 생성·원문 기록·접수 확인 게시(F1 즉시 확인)까지. 명확화 라운드는
   * startClarification 몫이라, 어댑터가 접수 응답을 먼저 돌려주고 라운드를 비동기로 돌릴 수 있다(G-1).
   */
  async openSession(event: IntakeEvent<A>): Promise<{ sessionId: string; existing: boolean }> {
    const { store, registry } = this.deps;
    const found = store.findSessionByThreadKey(event.threadKey);
    if (found) return { sessionId: found.id, existing: true };

    const versionAxes = ensureVersionAxes(store, registry);
    const session = store.createSession({
      originChannel: event.channel,
      channelThreadKey: event.threadKey,
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
    const language = this.languageOf(event);
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      ...(event.authorId !== undefined ? { authorId: event.authorId } : {}),
      channel: event.channel,
      originalText: event.text,
      originalLanguage: language,
    });
    // 접수 확인은 LLM 호출보다 먼저 나간다 (F1 수용기준 — 즉시 확인 응답)
    await this.deps.port.post(event.address, MESSAGES[language].ack);
    return { sessionId: session.id, existing: false };
  }

  /**
   * 개설된 세션의 명확화 라운드 실행 — intake·clarifying 상태에서만 동작한다.
   * 백그라운드 호출은 이벤트에 원문이 없으므로, 언어는 저장된 요청자 발화에서 되찾는다.
   */
  async startClarification(event: IntakeEvent<A>): Promise<void> {
    const session = this.deps.store.findSessionByThreadKey(event.threadKey);
    if (!session || (session.status !== 'intake' && session.status !== 'clarifying')) return;
    const stored = this.deps.store
      .listUtterances(session.id)
      .find((u) => u.authorType === 'requester')?.originalLanguage;
    const language =
      event.language ?? (stored === 'ko' || stored === 'en' ? stored : this.languageOf(event));
    await this.runClarificationRound(session.id, event, language);
  }

  /** 새 threadKey면 세션을 만들고 첫 라운드까지 원자적으로, 이미 있으면 답변으로 라우팅한다. */
  async handleIntake(event: IntakeEvent<A>): Promise<{ sessionId: string }> {
    const { sessionId, existing } = await this.openSession(event);
    if (existing) {
      await this.handleReply(event);
      return { sessionId };
    }
    await this.startClarification(event);
    return { sessionId };
  }

  /**
   * 요청자 발화 처리. 세션이 없거나 재개 불가한 종결이면 null.
   * 보류(정보 부족)는 입력=자동 재개(#30 — 정본 전이 보류→명확화), documented는
   * 슬롯 확인 정정의 재판정 경로로 허용된다(docgen 상태 내부 루프).
   */
  async handleReply(event: IntakeEvent<A>): Promise<ReplyOutcome | null> {
    return this.processReply(event, { correction: false });
  }

  private async processReply(
    event: IntakeEvent<A>,
    options: { correction: boolean },
  ): Promise<ReplyOutcome | null> {
    const { store } = this.deps;
    let session = store.findSessionByThreadKey(event.threadKey);
    if (!session) return null;
    if (session.status === 'closed') {
      if (session.terminalState !== 'on_hold_insufficient_info') return null;
      store.updateSessionState(session.id, { status: 'clarifying', terminalState: null });
      store.recordSignal({
        sessionId: session.id,
        type: 'session_resumed',
        payload: { previousRoundCount: session.roundCount },
        modelVersion: this.deps.modelVersion,
        ...this.versionAxesOf(session),
      });
      session = store.getSession(session.id);
      if (!session) return null;
    }

    const language = this.languageOf(event);
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      ...(event.authorId !== undefined ? { authorId: event.authorId } : {}),
      channel: event.channel,
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

    // LLM 슬롯 판정을 세션 슬롯 상태로 반영 — 승격 트리거 (F2c, US-10).
    // 판정 근거를 value로 영속해 슬롯 단위 확인 카드(F3)의 표시 텍스트로 쓴다.
    for (const slot of completeness.output.slots) {
      store.setSlotState({
        sessionId: session.id,
        slotKey: slot.slotKey,
        state: slot.verdict,
        value: slot.rationale,
      });
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
      return this.outcomeOf(session.id);
    }
    if (options.correction) {
      // 슬롯 정정의 되물음 (#30, §6 계약) — 왕복 상한에 산입하지 않고, 완성된 문서를
      // 보류로 파괴하지 않는다. 남은 공백(정정 슬롯)을 겨냥한 라운드만 연다.
      await this.runClarificationRound(session.id, event, language, { countRound: false });
      return this.outcomeOf(session.id);
    }
    if (session.roundCount < this.roundBudgetOf(session.id)) {
      await this.runClarificationRound(session.id, event, language);
      return this.outcomeOf(session.id);
    }
    // 상한 도달 + 승격조차 불가 — 사유 회신 후 보류(정보 부족) 종결 (원칙 5: 회신이 종결을 앞선다)
    await this.deps.port.post(event.address, MESSAGES[language].onHold);
    store.appendUtterance({
      sessionId: session.id,
      authorType: 'agent',
      channel: event.channel,
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
    return this.outcomeOf(session.id);
  }

  /**
   * 슬롯 단위 요청자 확인 (F3, 원칙 7). documented 세션에서만 —
   * 맞아요: confirmedByRequester 기록. 아니에요: 해당 슬롯을 미충족으로 되돌리고
   * event.text(정정 내용)를 재판정에 태운다. 정정 자체는 왕복 상한에 산입되지 않는다(#30).
   */
  async confirmSlot(
    event: IntakeEvent<A>,
    slotKey: string,
    confirmed: boolean,
  ): Promise<ReplyOutcome | null> {
    const { store } = this.deps;
    const session = store.findSessionByThreadKey(event.threadKey);
    if (!session || session.status !== 'documented') return null;
    const row = store.listSlotStates(session.id).find((slot) => slot.slotKey === slotKey);
    if (!row) return null;

    if (confirmed) {
      store.setSlotState({
        sessionId: session.id,
        slotKey,
        state: row.state as 'filled' | 'unfilled' | 'promoted',
        value: row.value ?? undefined,
        confirmedByRequester: true,
        ...(row.openIssueAssignee ? { openIssueAssignee: row.openIssueAssignee } : {}),
      });
      store.recordSignal({
        sessionId: session.id,
        type: 'slot_confirmed',
        payload: { slotKey },
        modelVersion: this.deps.modelVersion,
        ...this.versionAxesOf(session),
      });
      return this.outcomeOf(session.id);
    }

    store.setSlotState({ sessionId: session.id, slotKey, state: 'unfilled' });
    store.recordSignal({
      sessionId: session.id,
      type: 'slot_correction',
      payload: { slotKey },
      modelVersion: this.deps.modelVersion,
      ...this.versionAxesOf(session),
    });
    return this.processReply(event, { correction: true });
  }

  /** 왕복 예산 — 재개(#30)마다 상한이 한 번 더 주어진다. */
  roundBudgetOf(sessionId: string): number {
    const resumes = this.deps.store
      .listSignals(sessionId)
      .filter((signal) => signal.type === 'session_resumed').length;
    return this.maxRounds * (1 + resumes);
  }

  private languageOf(event: IntakeEvent<A>): 'ko' | 'en' {
    return event.language ?? detectRequesterLanguage(event.text);
  }

  private outcomeOf(sessionId: string): ReplyOutcome {
    const session = this.deps.store.getSession(sessionId);
    if (!session) throw new Error(`세션 조회 실패: ${sessionId}`);
    return { sessionId: session.id, status: session.status, terminalState: session.terminalState };
  }

  private async runClarificationRound(
    sessionId: string,
    event: IntakeEvent<A>,
    language: 'ko' | 'en',
    options: { countRound: boolean } = { countRound: true },
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
    await this.deps.port.post(event.address, text, {
      kind: 'clarification_questions',
      interpretations: result.output.interpretations,
      questions: result.output.questions,
    });
    store.appendUtterance({
      sessionId,
      authorType: 'agent',
      channel: event.channel,
      originalText: text,
      originalLanguage: language,
    });
    store.recordSignal({
      sessionId,
      type: 'clarification_round',
      payload: {
        round: options.countRound ? session.roundCount + 1 : session.roundCount,
        questionCount: result.output.questions.length,
        // 정정 되물음은 상한 미산입 (#30) — 관측을 위해 표식만 남긴다
        ...(options.countRound ? {} : { correction: true }),
        // 질문 구조를 신호에 영속 — 세션 재개 시 어댑터가 질문별 UI를 복원한다 (F11 관측 겸용)
        questions: result.output.questions,
      },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
    store.updateSessionState(sessionId, {
      status: 'clarifying',
      ...(options.countRound ? { roundCount: session.roundCount + 1 } : {}),
    });
  }

  private async deliverDocument(
    sessionId: string,
    event: IntakeEvent<A>,
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
    await this.deps.port.post(event.address, text);
    store.appendUtterance({
      sessionId,
      authorType: 'agent',
      channel: event.channel,
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
}
