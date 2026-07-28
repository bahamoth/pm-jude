import type { LlmBackend } from '../gateway/backend';
import { LlmGateway, type UsageLogger } from '../gateway/gateway';
import {
  CLARIFICATION_V2,
  COMPLETENESS_V1,
  PROMOTION_V0,
  REQUIREMENTS_V1,
} from '../prompts/catalog';
import type { ClarificationOutput } from '../prompts/clarification-v0';
import {
  COMPLETENESS_RUBRIC_V0,
  judgeCompleteness,
  runRuleLayer,
} from '../prompts/completeness-v0';
import type { CompletenessV1Output } from '../prompts/completeness-v1';
import type { PromotionOutput } from '../prompts/promotion-v0';
import {
  assembleRequirementsDocument,
  type RequirementsDocument,
  type RequirementsOutput,
} from '../prompts/requirements-v0';
import type { PromptRegistry } from '../prompts/registry';
import type { AttachmentStore } from '../store/attachment-store';
import type { SessionStore } from '../store/session-store';
import { UnsupportedMimeError, type ExtractorRegistry } from '../extract/registry';

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
  const clarification = registry.get(CLARIFICATION_V2);
  const promptVersionId =
    store.findVersionId('prompt', clarification.name, clarification.semver) ??
    store.registerPromptVersion({
      name: clarification.name,
      semver: clarification.semver,
      bodyRef: 'src/prompts/clarification-v2.ts',
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
  /**
   * 이 발화에 붙일 스테이징 업로드 (F1-Attach, ADR-0011 결정 2).
   * 채널 무관 계약이다 — 웹은 uploadId를, Slack 어댑터는 내려받은 파일을 같은 형태로 넘긴다.
   */
  uploadIds?: string[];
}

/**
 * 첨부 상한 (F1-Attach) — 수치는 전부 결정 대기다(PRD §12-19). 아래 값은 상한이 동작하는지
 * 확인하기 위한 자리이며, 운영자 결정이 나오면 교체한다.
 *
 * 파일당 크기와 개수는 참조 시점에 거부할 수 있지만, **추출 텍스트 총량은 추출 전에 알 수 없다**.
 * 그래서 총량 초과분은 추출하지 않고 사유를 단 실패로 남긴다 — 요청자는 무엇이 왜 반영되지
 * 않았는지 알게 되고, 조용히 잘려 「정보 부족」 보류로 끝나는 경로가 생기지 않는다.
 */
export interface AttachmentLimits {
  maxBytesPerFile: number;
  maxPerSession: number;
  maxSessionTextChars: number;
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxBytesPerFile: 20 * 1024 * 1024,
  maxPerSession: 10,
  maxSessionTextChars: 200_000,
};

/** 업로드 검증 실패 — 어댑터가 사유를 요청자에게 그대로 전한다. */
export class UploadRejectedError extends Error {}

export interface ReplyOutcome {
  sessionId: string;
  status: string;
  terminalState: string | null;
}

/** 신호에 함께 실리는 버전 축 (모델 버전은 러너가 들고 있다) — 세션 생성 시점 고정, F11. */
interface SignalVersionAxes {
  promptVersionId: string;
  thresholdVersionId: string;
  slotSchemaVersionId: string;
}

/** JSON 컬럼에서 읽은 값을 표시용 문자열로만 받아들인다 — 그 외 형태는 근거로 쓰지 않는다. */
function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 첨부 하나가 LLM 입력에 실리는 형태 — UUID가 아니라 짧은 참조로 오간다 (ADR-0011). */
interface AttachmentContext {
  ref: string;
  filename: string;
  text: string;
}

/** 요청 원문 + Q/A 쌍 + 첨부 — LLM 호출들이 함께 받는 맥락 (무상태 게이트웨이, F14). */
interface ConversationContext {
  request: string;
  conversation: Array<{ question: string; answer: string }>;
  attachments: AttachmentContext[];
  /** ref → attachment.id. 판정이 돌려준 참조를 실제 첨부로 되돌린다 — LLM 입력에는 싣지 않는다. */
  attachmentIdByRef: Map<string, string>;
}

/**
 * 요청자 언어 감지 초안 — 프로필 선호 언어(F1-Core)는 Phase 1 몫이라 PoC에서는
 * 발화 문자로 추정한다. 팀이 한국어·영어권 혼성이라는 전제(F2d)의 최소 구현.
 */
export function detectRequesterLanguage(text: string): 'ko' | 'en' {
  return /[가-힣]/.test(text) ? 'ko' : 'en';
}

/** 요청자에게 그대로 가는 문장 — Jude의 목소리다 (docs/persona/jude.md). */
const MESSAGES = {
  ko: {
    ack: '접수했어요. 요청을 정리하려고 몇 가지만 여쭤볼게요.',
    questionsHeader: '몇 가지만 확인할게요:',
    dontKnowHint: '답하기 어려운 게 있으면 그대로 알려주세요 — 제가 개발팀 몫으로 남겨둘게요',
    onHold:
      '지금은 정리하기에 정보가 부족해서 보류로 두었어요. 내용을 보태 주시면 이 자리에서 그대로 다시 진행할게요 — 지금까지 답하신 건 남아 있어요.',
  },
  en: {
    ack: "Got it. I'll ask a few questions to pin the request down.",
    questionsHeader: 'A few things to check:',
    dontKnowHint: "If you can't answer one, just say so — I'll flag it for the team",
    onHold:
      "There wasn't enough to work with yet, so I've parked this as on-hold. Add a little and I'll pick it up right here — everything you answered is still there.",
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
  /**
   * 첨부 원본 저장소·추출기 (F1-Attach). 둘 다 없으면 첨부 없는 세션만 도는 구성이 되고,
   * uploadIds가 실려 오면 거부한다 — 자료를 받아 놓고 조용히 버리는 상태를 만들지 않는다.
   */
  attachmentStore?: AttachmentStore;
  extractors?: ExtractorRegistry;
  limits?: AttachmentLimits;
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

function formatDocument(doc: RequirementsDocument, version: number): string {
  const { content } = doc;
  const lines = [
    // 문서 버전은 정정 재생성마다 올라간다 — 정본 ERD requirements_doc vN·역주입(F4)의 전제 (G-11)
    `*requirements 문서 v${String(version)}*`,
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
  private readonly limits: AttachmentLimits;

  constructor(private readonly deps: IntakeRunnerDeps<A>) {
    this.gateway = new LlmGateway({
      backend: deps.backend,
      registry: deps.registry,
      ...(deps.usageLogger ? { usageLogger: deps.usageLogger } : {}),
    });
    this.teamLanguage = deps.teamLanguage ?? 'ko';
    this.maxRounds = deps.maxRounds ?? 3;
    this.limits = deps.limits ?? DEFAULT_ATTACHMENT_LIMITS;
  }

  /** 첨부를 다룰 수 있는 구성인가 — 어댑터가 업로드 표면을 열지 판단하는 근거. */
  get attachmentsEnabled(): boolean {
    return this.deps.attachmentStore !== undefined && this.deps.extractors !== undefined;
  }

  /**
   * 업로드를 받기 전 검증 (F1-Attach) — 세션과 무관한 검사만 한다. 인테이크 시점에는
   * 세션이 아직 없으므로 여기서 세션 총량을 볼 수 없고, 그 검사는 참조 시점으로 미룬다.
   */
  validateUpload(input: { mime: string; bytes: number }): void {
    if (!this.deps.extractors) {
      throw new UploadRejectedError('이 서버는 자료 첨부를 받지 않는다');
    }
    if (!this.deps.extractors.supports(input.mime)) {
      throw new UploadRejectedError(`지원하지 않는 형식이다: ${input.mime}`);
    }
    if (input.bytes > this.limits.maxBytesPerFile) {
      const mb = Math.floor(this.limits.maxBytesPerFile / (1024 * 1024));
      throw new UploadRejectedError(`파일 하나는 ${String(mb)}MB까지 올릴 수 있다`);
    }
  }

  /** 요청자에게 「무엇을 올릴 수 있는가」를 알리는 근거 (P-U1 — 제출 후에 알게 하지 않는다). */
  supportedUploadMimes(): string[] {
    return this.deps.extractors?.supportedMimes() ?? [];
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
    const utterance = store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      ...(event.authorId !== undefined ? { authorId: event.authorId } : {}),
      channel: event.channel,
      originalText: event.text,
      originalLanguage: language,
    });
    this.attachUploads(session.id, utterance.id, event);
    // 접수 확인은 LLM 호출보다 먼저 나간다 (F1 수용기준 — 즉시 확인 응답).
    // 첨부가 있어도 마찬가지다: 검증은 업로드 때 끝났고 읽는 일은 접수 뒤로 미룬다.
    await this.deps.port.post(event.address, MESSAGES[language].ack);
    return { sessionId: session.id, existing: false };
  }

  /**
   * 발화에 업로드를 붙인다 (ADR-0011 결정 2). 세션이 확정된 시점이라 개수 상한을 여기서 본다.
   * 첨부를 다루지 못하는 구성인데 uploadIds가 실려 오면 거부한다 — 받아 놓고 버리지 않는다.
   */
  private attachUploads(sessionId: string, utteranceId: string, event: IntakeEvent<A>): void {
    const uploadIds = event.uploadIds ?? [];
    if (uploadIds.length === 0) return;
    if (!this.attachmentsEnabled) {
      throw new UploadRejectedError('이 서버는 자료 첨부를 받지 않는다');
    }
    const { store } = this.deps;
    const existing = store.listAttachments(sessionId).length;
    if (existing + uploadIds.length > this.limits.maxPerSession) {
      throw new UploadRejectedError(
        `요청 하나에 자료는 ${String(this.limits.maxPerSession)}개까지 붙일 수 있다`,
      );
    }
    const created = store.promoteUploads({ sessionId, utteranceId, uploadIds });
    const session = store.getSession(sessionId);
    if (!session) return;
    for (const attachment of created) {
      store.recordSignal({
        sessionId,
        type: 'attachment_uploaded',
        payload: {
          attachmentId: attachment.id,
          mime: attachment.mime,
          bytes: attachment.bytes,
        },
        modelVersion: this.deps.modelVersion,
        ...this.versionAxesOf(session),
      });
    }
  }

  /**
   * 아직 읽지 않은 첨부를 읽는다 — 라운드 백그라운드의 첫 단계다 (ADR-0011 결정 9).
   * 새 세션 상태를 만들지 않으므로 동시성·SSE·재시도 계약이 그대로 적용된다.
   *
   * 실패는 라운드를 죽이지 않는다(P-U3). 세션 텍스트 총량을 넘어서는 첨부도 실패로 남긴다 —
   * 추출 전에는 길이를 알 수 없어 업로드 시점에 거부할 수 없고, 조용히 버리면 요청자는
   * 자료가 반영됐다고 믿은 채 「정보 부족」을 받는다.
   */
  private async extractPendingAttachments(sessionId: string): Promise<void> {
    const { store, attachmentStore, extractors } = this.deps;
    if (!attachmentStore || !extractors) return;
    const attachments = store.listAttachments(sessionId);
    const pending = attachments.filter((row) => row.extractionStatus === 'pending');
    if (pending.length === 0) return;
    const session = store.getSession(sessionId);
    if (!session) return;
    const versionAxes = this.versionAxesOf(session);
    let usedChars = attachments.reduce((sum, row) => sum + (row.extractedText?.length ?? 0), 0);

    for (const row of pending) {
      let outcome: { status: 'ok' | 'failed'; text?: string; error?: string; version: string };
      try {
        const result = await extractors.extract({
          bytes: attachmentStore.read(row.storageRef),
          filename: row.filename,
          mime: row.mime,
        });
        outcome = { ...result, version: result.extractorVersion };
      } catch (error) {
        // 미등록 MIME이 여기 오는 것은 업로드 검증이 뚫렸다는 뜻이다 — 사유를 남겨 드러낸다
        const message =
          error instanceof UnsupportedMimeError
            ? `업로드 검증을 통과했지만 추출기가 없다: ${row.mime}`
            : `원본을 읽지 못했다: ${error instanceof Error ? error.message : String(error)}`;
        outcome = { status: 'failed', error: message, version: 'none' };
      }

      if (
        outcome.status === 'ok' &&
        usedChars + (outcome.text?.length ?? 0) > this.limits.maxSessionTextChars
      ) {
        outcome = {
          status: 'failed',
          error: '이 요청에 담을 수 있는 자료 분량을 넘었다',
          version: outcome.version,
        };
      }

      if (outcome.status === 'ok') {
        usedChars += outcome.text?.length ?? 0;
        store.setExtraction({
          id: row.id,
          status: 'ok',
          extractedText: outcome.text ?? '',
          extractorVersion: outcome.version,
        });
      } else {
        store.setExtraction({
          id: row.id,
          status: 'failed',
          extractionError: outcome.error ?? '알 수 없는 실패',
          extractorVersion: outcome.version,
        });
      }
      store.recordSignal({
        sessionId,
        type: outcome.status === 'ok' ? 'attachment_extracted' : 'attachment_extraction_failed',
        payload: {
          attachmentId: row.id,
          mime: row.mime,
          // 추출기 버전은 신호 payload에 남는다 — 버전 축은 5축을 유지한다 (ADR-0011 결정 5)
          extractorVersion: outcome.version,
          ...(outcome.status === 'ok'
            ? { textLength: outcome.text?.length ?? 0 }
            : { error: outcome.error }),
        },
        modelVersion: this.deps.modelVersion,
        ...versionAxes,
      });
    }
  }

  /**
   * 개설된 세션의 명확화 라운드 실행 — intake·clarifying 상태에서만 동작한다.
   * 백그라운드 호출은 이벤트에 원문이 없으므로, 언어는 저장된 요청자 발화에서 되찾는다.
   */
  async startClarification(event: IntakeEvent<A>): Promise<void> {
    const session = this.deps.store.findSessionByThreadKey(event.threadKey);
    if (!session || (session.status !== 'intake' && session.status !== 'clarifying')) return;
    // 자료를 먼저 읽는다 — 읽지 않은 채 질문을 만들면 자료에 있는 것을 되묻게 된다
    await this.extractPendingAttachments(session.id);
    await this.runClarificationRound(session.id, event, this.sessionLanguageOf(session.id, event));
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
    return this.processReply(event, { correction: false, appendUtterance: true });
  }

  /**
   * 실패한 라운드에 재시도할 것이 있는가 (G-10, #28 S-4) — 어댑터가 재시도 CTA를 띄우거나
   * 재시도 요청을 거부할 때 쓴다. 판정이 죽으면 요청자 발화만 남고 응답이 없으므로,
   * 마지막 발화가 요청자면 미완 라운드다.
   */
  pendingRound(threadKey: string): 'clarification' | 'judgement' | null {
    const session = this.deps.store.findSessionByThreadKey(threadKey);
    if (!session) return null;
    if (session.status === 'intake') return 'clarification';
    if (session.status === 'closed') return null; // 종결 세션의 재개는 입력이 하는 일 (#30)
    const last = this.deps.store.listUtterances(session.id).at(-1);
    return last?.authorType === 'requester' ? 'judgement' : null;
  }

  /**
   * 미완 라운드의 멱등 재시도 (G-10) — 이미 저장된 발화를 다시 적지 않고 죽은 단계만 다시 돌린다.
   * 질문 생성이 죽었으면 질문 생성을, 판정이 죽었으면 판정부터. 재시도할 것이 없으면 null이라
   * 재시도가 예산을 먹거나 판정을 건너뛰고 질문만 만들어 내는 일이 없다.
   */
  async retryRound(event: IntakeEvent<A>): Promise<ReplyOutcome | null> {
    const pending = this.pendingRound(event.threadKey);
    if (pending === null) return null;
    const session = this.deps.store.findSessionByThreadKey(event.threadKey);
    if (!session) return null;
    if (pending === 'clarification') {
      await this.startClarification(event);
      return this.outcomeOf(session.id);
    }
    return this.processReply(event, {
      // documented 세션의 미완 라운드는 슬롯 정정의 재판정이다 — 상한 미산입 규칙을 유지한다
      correction: session.status === 'documented',
      appendUtterance: false,
    });
  }

  private async processReply(
    event: IntakeEvent<A>,
    options: { correction: boolean; appendUtterance: boolean },
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

    // 재시도는 발화를 다시 적지 않으므로, 언어도 이 이벤트가 아니라 세션 기록을 근거로 삼는다 (G-10)
    const language = options.appendUtterance
      ? this.languageOf(event)
      : this.sessionLanguageOf(session.id, event);
    if (options.appendUtterance) {
      const utterance = store.appendUtterance({
        sessionId: session.id,
        authorType: 'requester',
        ...(event.authorId !== undefined ? { authorId: event.authorId } : {}),
        channel: event.channel,
        originalText: event.text,
        originalLanguage: language,
      });
      this.attachUploads(session.id, utterance.id, event);
    }
    // 판정 전에 자료를 읽는다 — 방금 붙인 것도 이 라운드의 근거가 되어야 한다
    await this.extractPendingAttachments(session.id);

    const versionAxes = this.versionAxesOf(session);
    const context = this.buildConversation(session.id);
    const completeness = await this.gateway.complete<CompletenessV1Output>(COMPLETENESS_V1, {
      request: context.request,
      conversation: context.conversation,
      attachments: context.attachments,
      teamLanguage: this.teamLanguage,
      requiredSlots: TEMP_REQUIRED_SLOTS,
    });

    // LLM 슬롯 판정을 세션 슬롯 상태로 반영 — 승격 트리거 (F2c, US-10).
    // 판정 근거를 value로 영속해 슬롯 단위 확인 카드(F3)의 표시 텍스트로 쓴다.
    // 첨부에서 읽은 값은 출처를 함께 남긴다 — 요청자가 말한 적 없는 값이라 확인 화면이
    // 어디서 왔는지 보여줘야 「맞아요 / 아니에요」가 판단 가능한 물음이 된다 (ADR-0011 결정 8).
    for (const slot of completeness.output.slots) {
      const attachmentId = this.attachmentIdOf(slot.evidence, context);
      store.setSlotState({
        sessionId: session.id,
        slotKey: slot.slotKey,
        state: slot.verdict,
        value: slot.rationale,
        ...(attachmentId ? { evidenceAttachmentId: attachmentId } : {}),
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
      await this.deliverDocument(session.id, event, completeness.output, context);
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
    // 상한 도달 — 남은 미충족 슬롯의 승격 가능 판정이 먼저다 (F2c ①②, G-9).
    // 승격 가능하면 오픈이슈를 실은 조건부 문서로, 불가하면 아래 보류로 흐른다.
    if ((await this.judgeCapReached(session.id, context, versionAxes)) === 'deliver') {
      await this.deliverDocument(session.id, event, completeness.output, context, {
        conditional: true,
      });
      return this.outcomeOf(session.id);
    }
    // 승격조차 불가 — 사유 회신 후 보류(정보 부족) 종결 (원칙 5: 회신이 종결을 앞선다)
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
      this.recordCompletion(session.id, this.versionAxesOf(session));
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
    return this.processReply(event, { correction: true, appendUtterance: true });
  }

  /**
   * 상한 도달 시점의 판정 (F2c ①②③, G-9, #28 S-1) — 남은 미충족 슬롯 각각이 담당자 몫으로
   * 넘어갈 수 있는지 LLM 층에 묻고, **전부 가능할 때만** 승격시킨다. 하나라도 불가하면 슬롯 상태를
   * 건드리지 않는다: 핵심이 빈 부분 승격 문서는 구현 착수의 근거가 되지 못하므로 보류가 정직하다.
   * 전이 자체는 호출자 코드가 결정한다 (ADR-0001) — 여기서 돌려주는 것은 판정 결과뿐이다.
   */
  private async judgeCapReached(
    sessionId: string,
    context: ConversationContext,
    versionAxes: SignalVersionAxes,
  ): Promise<'deliver' | 'hold'> {
    const { store } = this.deps;
    const rowBySlot = new Map(store.listSlotStates(sessionId).map((slot) => [slot.slotKey, slot]));
    const unfilled = TEMP_REQUIRED_SLOTS.filter(
      (slot) => (rowBySlot.get(slot.key)?.state ?? 'unfilled') === 'unfilled',
    );
    // 미충족 슬롯이 없으면 룰 층은 이미 통과다 — 남은 것은 해석 모호성(루브릭)이고 왕복은 끝났다.
    // 「정보 부족」이 아니므로 보류로 보내지 않는다. 모호성은 completeness_check 신호에 남아 F12 몫.
    if (unfilled.length === 0) return 'deliver';

    const result = await this.gateway.complete<PromotionOutput>(PROMOTION_V0, {
      request: context.request,
      conversation: context.conversation,
      // promotion은 본문이 바뀌지 않았다 — 첨부는 컨텍스트만 늘린다 (ADR-0011 결정 12)
      attachments: context.attachments,
      teamLanguage: this.teamLanguage,
      unfilledSlots: unfilled.map((slot) => ({
        key: slot.key,
        label: slot.label,
        rationale: nonEmptyText(rowBySlot.get(slot.key)?.value) ?? '',
      })),
    });
    const decisionBySlot = new Map(
      result.output.decisions.map((decision) => [decision.slotKey, decision]),
    );
    // 판정이 없는 슬롯은 승격 불가로 취급한다 — 누락이 통과가 되지 않게
    const promotable = unfilled.filter((slot) => decisionBySlot.get(slot.key)?.promotable === true);
    const blocking = unfilled.filter((slot) => !promotable.includes(slot));
    store.recordSignal({
      sessionId,
      type: 'promotion_judged',
      payload: {
        promotable: promotable.map((slot) => slot.key),
        blocking: blocking.map((slot) => slot.key),
        decisions: result.output.decisions,
      },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
    if (blocking.length > 0) return 'hold';

    for (const slot of promotable) {
      const decision = decisionBySlot.get(slot.key);
      store.setSlotState({
        sessionId,
        slotKey: slot.key,
        state: 'promoted',
        // 담당자가 읽는 오픈이슈 질문을 값으로 남긴다 — 문서 조립이 이 값을 쓴다
        value: decision?.openIssueQuestion ?? decision?.rationale,
      });
    }
    // 승격 후에도 판정은 룰 층이 한다 (원칙 2 — 결정론적 백스톱을 우회하지 않는다)
    const rule = runRuleLayer({
      requiredSlots: TEMP_REQUIRED_SLOTS,
      slotStates: store.listSlotStates(sessionId),
    });
    return rule.passed ? 'deliver' : 'hold';
  }

  /**
   * Phase 0 종착 기록 (G-11, #28 S-6) — 문서가 나온 뒤 요청자가 확인할 수 있는 슬롯(충족)이
   * 모두 「맞아요」로 확인되면 완주다. 승격 슬롯은 담당자 몫이라 분모에 넣지 않으므로,
   * 전면 승격 문서는 확인할 것이 없어 게시 시점에 곧바로 완주다 (P-U3 — 요청자가 답할 수 없어서
   * 멈추는 상태는 없다). #11 완주율의 분자가 이 신호다.
   *
   * 기록 단위는 **문서 버전**이다: 정정 재판정은 모든 슬롯 확인을 되돌리므로, 새 문서에는 새 확인이
   * 필요하고 완주도 그 버전에서 다시 성립한다. 같은 버전을 두 번 세지 않는다.
   */
  private recordCompletion(sessionId: string, versionAxes: SignalVersionAxes): void {
    const { store } = this.deps;
    const version = this.documentVersionOf(sessionId);
    if (version === 0) return; // 문서 없이 완주는 없다
    const slots = store.listSlotStates(sessionId);
    const confirmable = slots.filter((slot) => slot.state === 'filled');
    if (!confirmable.every((slot) => slot.confirmedByRequester)) return;
    const recorded = store
      .listSignals(sessionId)
      .some(
        (signal) =>
          signal.type === 'session_completed' &&
          (signal.payload as { version?: number } | null)?.version === version,
      );
    if (recorded) return;
    store.recordSignal({
      sessionId,
      type: 'session_completed',
      payload: {
        reason: confirmable.length > 0 ? 'all_slots_confirmed' : 'fully_promoted',
        version,
        confirmedSlotCount: confirmable.length,
        promotedSlotCount: slots.filter((slot) => slot.state === 'promoted').length,
      },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
  }

  /** 현재 문서 버전에서 완주가 기록됐는가 — 어댑터의 완료 표시 근거 (G-11). */
  isCompleted(sessionId: string): boolean {
    const version = this.documentVersionOf(sessionId);
    if (version === 0) return false;
    return this.deps.store
      .listSignals(sessionId)
      .some(
        (signal) =>
          signal.type === 'session_completed' &&
          (signal.payload as { version?: number } | null)?.version === version,
      );
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

  /**
   * 세션에 기록된 요청자 언어 — 원문이 없는 이벤트(백그라운드 라운드·재시도)의 근거다.
   * 발화를 새로 적을 때는 그 발화의 문자로 감지한다 (요청자가 언어를 바꿀 수 있다).
   */
  private sessionLanguageOf(sessionId: string, event: IntakeEvent<A>): 'ko' | 'en' {
    if (event.language) return event.language;
    const stored = this.deps.store
      .listUtterances(sessionId)
      .find((utterance) => utterance.authorType === 'requester')?.originalLanguage;
    if (stored === 'ko' || stored === 'en') return stored;
    return detectRequesterLanguage(event.text);
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
    const result = await this.gateway.complete<ClarificationOutput>(CLARIFICATION_V2, {
      request,
      requesterLanguage: language,
      requiredSlots: TEMP_REQUIRED_SLOTS.map((slot) => ({
        ...slot,
        state: stateBySlot.get(slot.key) === 'filled' ? 'filled' : 'unfilled',
      })),
      // 자료를 함께 준다 — 이미 답이 있는 것을 되물으면 첨부가 왕복을 늘리는 셈이 된다
      attachments: this.buildConversation(sessionId).attachments,
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
    const posted = store.appendUtterance({
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
        // 질문 발화의 순번 — 이 라운드가 이미 답을 받았는지 판별하는 기준점 (G-10 라운드 정합)
        utteranceSeq: posted.seq,
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
    completeness: CompletenessV1Output,
    context: ConversationContext,
    options: { conditional: boolean } = { conditional: false },
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
        // 슬롯에 남은 값이 1순위 — 상한 승격(G-9)은 담당자용 오픈이슈 질문을 여기 적어 둔다
        question:
          nonEmptyText(slot.value) ??
          rationaleBySlot.get(slot.slotKey) ??
          `${slot.slotKey} 확정 필요`,
      }));

    const result = await this.gateway.complete<RequirementsOutput>(REQUIREMENTS_V1, {
      request: context.request,
      teamLanguage: this.teamLanguage,
      clarifications: context.conversation,
      promotedSlots: promotedSlots.map(({ slotKey, question }) => ({ key: slotKey, question })),
      // 자료에서 확정된 것은 문서 문장으로 흡수된다 — 첨부를 지워도 구현 가능해야 한다 (원칙 7)
      attachments: context.attachments,
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

    // 문서 버전은 게시 이력으로 센다 — 정정 재생성이 무버전 덮어쓰기로 보이지 않게 (G-11)
    const version = this.documentVersionOf(sessionId) + 1;
    const text = formatDocument(doc, version);
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
      payload: {
        version,
        openIssueCount: doc.content.openIssues.length,
        // 상한 도달 후 승격으로 통과한 문서 — 게이트 도입 시 조건부 상정의 근거 (F2c ②)
        conditional: options.conditional,
      },
      modelVersion: this.deps.modelVersion,
      ...versionAxes,
    });
    // 확인할 슬롯이 없는 문서(전면 승격)는 게시 시점이 곧 종착이다 (G-11)
    this.recordCompletion(sessionId, versionAxes);
  }

  /** 지금까지 게시된 requirements 문서 수 = 현재 문서의 버전. 문서 전이면 0 (G-11). */
  documentVersionOf(sessionId: string): number {
    return this.deps.store
      .listSignals(sessionId)
      .filter((signal) => signal.type === 'document_delivered').length;
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

  /**
   * 전사에서 요청 원문·Q/A 쌍·첨부를 조립한다 — 게이트웨이 호출은 무상태이므로 매번 저장소에서
   * 만든다 (F14). 첨부는 **발화와 구분되어** 실린다: 추출 텍스트를 요청자 발화에 이어 붙이면
   * 판정이 그것을 요청자가 한 말로 오귀속해 출처 추적이 성립하지 않는다 (ADR-0011 결정 8).
   * 읽지 못한 첨부는 빠진다 — 실패 사실은 화면과 신호에 남고, 판정에 빈 텍스트를 넣지 않는다.
   */
  private buildConversation(sessionId: string): ConversationContext {
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
    const attachments: AttachmentContext[] = [];
    const attachmentIdByRef = new Map<string, string>();
    for (const row of this.deps.store.listAttachments(sessionId)) {
      if (row.extractionStatus !== 'ok' || !row.extractedText) continue;
      // 짧은 참조로 오간다 — 모델에게 UUID를 옮겨 적게 하면 그 자체가 오류원이 된다
      const ref = `A${String(attachments.length + 1)}`;
      attachments.push({ ref, filename: row.filename, text: row.extractedText });
      attachmentIdByRef.set(ref, row.id);
    }
    return { request, conversation, attachments, attachmentIdByRef };
  }

  /** 판정이 가리킨 첨부 참조를 실제 id로 되돌린다. 알 수 없는 참조는 근거 없음으로 취급한다. */
  private attachmentIdOf(
    evidence: { source: 'conversation' | 'attachment'; attachmentRef?: string },
    context: ConversationContext,
  ): string | undefined {
    if (evidence.source !== 'attachment' || !evidence.attachmentRef) return undefined;
    return context.attachmentIdByRef.get(evidence.attachmentRef);
  }
}
