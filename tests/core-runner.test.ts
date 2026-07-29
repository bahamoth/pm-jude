import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtractorRegistry } from '../src/extract/registry';
import { textExtractor } from '../src/extract/text';
import type { Extractor } from '../src/extract/types';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { AttachmentStore } from '../src/store/attachment-store';
import type { SlotTriState } from '../src/prompts/completeness-v0';
import type { CompletenessV1Output } from '../src/prompts/completeness-v1';
import type { PromotionOutput } from '../src/prompts/promotion-v0';
import {
  DEFAULT_ATTACHMENT_LIMITS,
  detectRequesterLanguage,
  IntakeRunner,
  UploadRejectedError,
  UtteranceRejectedError,
  type AttachmentLimits,
  type ChannelPort,
  type ClarificationRoundPayload,
} from '../src/runner/core-runner';
import type { NotionFetchResult, NotionPageSource } from '../src/connect/notion';
import { SessionStore } from '../src/store/session-store';
import {
  nonUiClassificationResponse,
  refinedCompletenessResponse,
  requirementsResponse,
} from './slot-fixture';

/**
 * 코어 러너 시임 테스트 (#16) — 채널 비의존 파이프라인의 분기 케이스를 여기서 검증한다.
 * slack-runner.test.ts의 분기 케이스(승격/보류, 왕복 상한, 언어 감지)를 이관해 재구성했고,
 * Slack 테스트에는 어댑터 배선(주소 매핑·이벤트 라우팅)만 남긴다.
 */

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}
  requests: BackendRequest[] = [];

  run(request: BackendRequest): Promise<BackendResponse> {
    this.requests.push(request);
    const text = this.responses.shift();
    if (text === undefined) throw new Error('ScriptedBackend: 준비된 응답 없음');
    return Promise.resolve({ outputText: text, usage: { inputTokens: 100, outputTokens: 50 } });
  }
}

/** 회신 주소로 문자열 태그를 쓰는 최소 포트 — 코어는 주소를 해석하지 않고 흘려보내야 한다. */
class FakePort implements ChannelPort<string> {
  posted: Array<{ address: string; text: string; payload?: ClarificationRoundPayload }> = [];

  post(address: string, text: string, payload?: ClarificationRoundPayload): Promise<void> {
    this.posted.push({ address, text, ...(payload ? { payload } : {}) });
    return Promise.resolve();
  }
}

const clarificationResponse = JSON.stringify({
  interpretations: ['관리자용 실적 대시보드'],
  questions: [
    {
      question: '이 대시보드는 주로 누가 보게 되나요?',
      target: { type: 'slot', slotKey: 'target-user' },
      exampleOptions: ['영업팀 매니저', '영업사원 본인'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '어떤 문제를 해결하려는 건가요?',
      target: { type: 'slot', slotKey: 'purpose' },
      exampleOptions: ['수작업 집계 제거', '실적 공유'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '데이터는 어디에서 가져오면 되나요?',
      target: { type: 'slot', slotKey: 'data-source' },
      exampleOptions: ['CRM', '사내 DB'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
  ],
});

/**
 * 판정 슬롯 픽스처 (completeness@0.2.0) — attachmentRef를 주면 첨부 유래,
 * 없으면 대화 유래다. 출처는 확인 화면의 표시와 F13 판독의 근거가 된다 (ADR-0011 결정 8).
 */
function slot(slotKey: string, verdict: SlotTriState, rationale: string, attachmentRef?: string) {
  return {
    slotKey,
    verdict,
    rationale,
    evidence: attachmentRef
      ? { source: 'attachment' as const, attachmentRef }
      : { source: 'conversation' as const },
  };
}

// refinedCompletenessResponse·requirementsResponse는 Slack 심과 공용 — tests/slot-fixture.ts

/** 첨부에서 대상 사용자를 읽어낸 판정 — 출처가 슬롯에 남는다 (F2c). */
const attachmentEvidenceResponse = JSON.stringify({
  slots: [
    slot('target-user', 'filled', '올려주신 기획서에 대상 사용자가 적혀 있음', 'A1'),
    slot('purpose', 'filled', '수작업 집계 제거라고 답함'),
    slot('data-source', 'promoted', '요청자가 「모르겠어요」를 택함'),
  ],
  remainingAmbiguities: [],
  rubric: { score: 90, rationale: '핵심 슬롯 모두 해소' },
} satisfies CompletenessV1Output);

/** purpose가 여전히 미충족 — 미정제로 이끄는 판정. */
const unrefinedCompletenessResponse = JSON.stringify({
  slots: [
    slot('target-user', 'filled', '「영업팀 매니저」라고 확답'),
    slot('purpose', 'unfilled', '어떤 문제를 푸는지 답이 없음'),
    slot('data-source', 'unfilled', '데이터 출처 답이 없음'),
  ],
  remainingAmbiguities: ['해결하려는 문제가 불명'],
  rubric: { score: 35, rationale: '핵심이 비어 있음' },
} satisfies CompletenessV1Output);

/** 상한 도달 시점의 승격 판정 — 남은 미충족 슬롯이 전부 담당자 몫으로 넘어간다 (F2c ①②). */
const promotableResponse = JSON.stringify({
  decisions: [
    {
      slotKey: 'purpose',
      promotable: true,
      rationale: '대화에 문제 상황이 드러나 담당자가 범위를 정할 수 있다',
      openIssueQuestion: '대시보드가 답해야 할 핵심 질문을 무엇으로 확정할 것인가',
    },
    {
      slotKey: 'data-source',
      promotable: true,
      rationale: '데이터의 진실 원천은 담당자가 정하는 항목이다',
      openIssueQuestion: '매출 집계의 진실 원천으로 어느 저장소를 쓸 것인가',
    },
  ],
} satisfies PromotionOutput);

/** purpose는 담당자도 대신 정할 수 없다 — 보류로 이끄는 판정 (F2c ③). */
const blockingPromotionResponse = JSON.stringify({
  decisions: [
    {
      slotKey: 'purpose',
      promotable: false,
      rationale: '무엇을 해결하려는지가 대화 어디에도 없어 담당자가 대신 정할 수 없다',
    },
    {
      slotKey: 'data-source',
      promotable: true,
      rationale: '진실 원천은 담당자가 정하는 항목이다',
      openIssueQuestion: '매출 집계의 진실 원천으로 어느 저장소를 쓸 것인가',
    },
  ],
} satisfies PromotionOutput);

/** 슬롯은 전부 해소됐지만 루브릭이 임계치 미달 — 룰 층은 통과하는데 미정제인 판정. */
const lowScoreCompletenessResponse = JSON.stringify({
  slots: [
    slot('target-user', 'filled', '「영업팀 매니저」라고 확답'),
    slot('purpose', 'filled', '수작업 집계 제거라고 답함'),
    slot('data-source', 'filled', 'CRM이라고 답함'),
  ],
  remainingAmbiguities: ['어느 기간 단위로 보는지'],
  rubric: { score: 60, rationale: '슬롯은 찼지만 해석이 갈라진다' },
} satisfies CompletenessV1Output);

/** 전 문항 「모르겠다」 — 전 슬롯 승격으로 룰 층을 통과하는 판정 (#28 S-5). */
const fullyPromotedCompletenessResponse = JSON.stringify({
  slots: [
    slot('target-user', 'promoted', '요청자가 「모르겠어요」를 택함'),
    slot('purpose', 'promoted', '요청자가 「모르겠어요」를 택함'),
    slot('data-source', 'promoted', '요청자가 「모르겠어요」를 택함'),
  ],
  remainingAmbiguities: [],
  rubric: { score: 85, rationale: '전 항목이 담당자 몫으로 정리됨' },
} satisfies CompletenessV1Output);

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function makeRunner(
  responses: string[],
  options?: {
    maxRounds?: number;
    attachments?: { store: AttachmentStore; extractors: ExtractorRegistry };
    limits?: Partial<AttachmentLimits>;
    maxUtteranceChars?: number;
    condense?: { targetChars?: number; budgetChars?: number };
    notion?: NotionPageSource;
    llm?: { timeoutMs?: number; maxConcurrency?: number };
  },
) {
  store = SessionStore.open(':memory:');
  const port = new FakePort();
  const backend = new ScriptedBackend(responses);
  const runner = new IntakeRunner<string>({
    store,
    backend,
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    port,
    teamLanguage: 'ko',
    ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options?.maxUtteranceChars !== undefined
      ? { maxUtteranceChars: options.maxUtteranceChars }
      : {}),
    ...(options?.condense ? { condense: options.condense } : {}),
    ...(options?.notion ? { notion: options.notion } : {}),
    ...(options?.llm ? { llm: options.llm } : {}),
    ...(options?.attachments
      ? {
          attachmentStore: options.attachments.store,
          createExtractors: () => options.attachments!.extractors,
        }
      : {}),
    ...(options?.limits ? { limits: { ...DEFAULT_ATTACHMENT_LIMITS, ...options.limits } } : {}),
  });
  return { runner, port, backend, store };
}

/** 원본 저장소와 등록된 추출기를 붙인 러너 — 첨부를 다루는 구성 (F1-Attach). */
function makeAttachmentRunner(
  responses: string[],
  options?: {
    maxRounds?: number;
    limits?: Partial<AttachmentLimits>;
    extractor?: Extractor;
    condense?: { targetChars?: number; budgetChars?: number };
    notion?: NotionPageSource;
  },
) {
  const blobs = new AttachmentStore(mkdtempSync(join(tmpdir(), 'pm-jude-core-attach-')));
  const extractors = new ExtractorRegistry();
  extractors.register(options?.extractor ?? textExtractor);
  const made = makeRunner(responses, {
    ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options?.limits ? { limits: options.limits } : {}),
    ...(options?.condense ? { condense: options.condense } : {}),
    ...(options?.notion ? { notion: options.notion } : {}),
    attachments: { store: blobs, extractors },
  });
  /** 파일을 저장소에 넣고 스테이징까지 마친다 — 어댑터(#49)가 할 일의 최소 재현. */
  const stage = (filename: string, text: string, mime = 'text/plain') => {
    const bytes = Buffer.from(text, 'utf8');
    const stored = blobs.put(bytes);
    return made.store.stageUpload({
      filename,
      mime,
      bytes: bytes.length,
      sha256: stored.sha256,
      storageRef: stored.storageRef,
    });
  };
  return { ...made, blobs, stage };
}

const intake = {
  address: 'reply-to:thread-1',
  threadKey: 'web:thread-1',
  channel: 'web' as const,
  authorId: 'requester-kim',
  text: '영업 실적 대시보드 하나 만들어 주세요',
};

describe('요청자 언어 감지 초안 (F2d)', () => {
  it('한글이 섞이면 ko, 아니면 en으로 감지한다', () => {
    expect(detectRequesterLanguage('영업 실적 대시보드 만들어 주세요')).toBe('ko');
    expect(detectRequesterLanguage('Please build a sales dashboard')).toBe('en');
  });
});

describe('코어 러너 — 인테이크', () => {
  it('접수 확인이 질문보다 먼저 같은 주소로 게시되고 세션이 영속된다', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    const result = await runner.handleIntake(intake);

    expect(port.posted.length).toBe(2);
    // 주소는 코어가 해석하지 않고 포트에 그대로 흘러간다 (채널 어댑터 원칙)
    expect(port.posted[0]?.address).toBe('reply-to:thread-1');
    expect(port.posted[1]?.address).toBe('reply-to:thread-1');
    expect(port.posted[1]?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');
    expect(port.posted[1]?.text).toContain('모르겠어요 — 개발팀이 정해 주세요');
    // 질문 게시에는 어댑터용 구조화 페이로드가 동봉된다 (질문별 UI·CLI 렌더링 — US-4·US-5)
    expect(port.posted[0]?.payload).toBeUndefined(); // 접수 확인은 텍스트뿐
    expect(port.posted[1]?.payload).toMatchObject({
      kind: 'clarification_questions',
      interpretations: ['관리자용 실적 대시보드'],
    });
    expect(port.posted[1]?.payload?.questions).toHaveLength(3);

    const session = store.findSessionByThreadKey('web:thread-1');
    expect(session).toMatchObject({
      id: result.sessionId,
      status: 'clarifying',
      roundCount: 1,
      originChannel: 'web',
    });

    const exported = store.exportSessions();
    expect(exported[0]).toMatchObject({
      utterances: [
        { authorType: 'requester', originalLanguage: 'ko', channel: 'web' },
        { authorType: 'agent' }, // 게시한 질문도 전사에 남는다 (원칙 7)
      ],
      signals: [{ type: 'clarification_round' }],
    });
    // 질문 구조가 신호에 영속된다 — 세션 재개 시 어댑터가 질문별 UI를 복원한다
    const round = exported[0]?.signals[0]?.payload as { questions?: unknown[] };
    expect(round.questions).toHaveLength(3);
  });

  it('명시 언어가 있으면 발화 문자 감지보다 우선한다 (웹 간이 식별)', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    // 한글 발화지만 요청자가 언어를 en으로 선택한 경우
    await runner.handleIntake({ ...intake, language: 'en' });

    expect(port.posted[0]?.text).toMatch(/[A-Za-z]/);
    expect(port.posted[0]?.text).not.toMatch(/[가-힣]/);
    expect(store.exportSessions()[0]?.utterances[0]).toMatchObject({ originalLanguage: 'en' });
  });

  it('명시 언어가 없으면 발화 문자로 감지한다', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    await runner.handleIntake({ ...intake, text: 'Please build a sales dashboard' });

    expect(port.posted[0]?.text).not.toMatch(/[가-힣]/);
    expect(store.exportSessions()[0]?.utterances[0]).toMatchObject({ originalLanguage: 'en' });
  });

  it('같은 threadKey의 재인테이크는 새 세션이 아니라 답변으로 라우팅된다', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      unrefinedCompletenessResponse,
      clarificationResponse, // 답변 취급 → 미정제 → 다음 라운드 질문
    ]);

    await runner.handleIntake(intake);
    await runner.handleIntake({ ...intake, text: '아까 그 요청이요' });

    expect(store.exportSessions()).toHaveLength(1);
  });
});

describe('코어 러너 — 답변과 2층 판정 분기', () => {
  it('정제 완료면 requirements 문서가 게시되고 세션이 documented가 된다', async () => {
    const { runner, port, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
    ]);
    await runner.handleIntake(intake);

    const result = await runner.handleReply({
      ...intake,
      text: '영업팀 매니저가 봅니다. 수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
    });

    const doc = port.posted.at(-1)?.text ?? '';
    expect(doc).toContain('영업 실적을 정리해 볼 수단이 없어');
    expect(doc).toContain('오픈이슈'); // 승격 슬롯이 문서에 실린다 (F2c)
    expect(doc).toContain('data-source');

    expect(result?.status).toBe('documented');
    expect(store.findSessionByThreadKey('web:thread-1')?.status).toBe('documented');

    // LLM 슬롯 판정이 세션 슬롯 상태로 반영된다 (승격 트리거 — US-10)
    expect(store.exportSessions()[0]?.slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotKey: 'data-source', state: 'promoted' }),
        expect.objectContaining({ slotKey: 'target-user', state: 'filled' }),
      ]),
    );
    // 판정 신호에 룰·LLM 판정이 함께 남는다 (F2 수용기준)
    const check = store
      .exportSessions()[0]
      ?.signals.find((signal) => signal.type === 'completeness_check');
    expect(check?.payload).toMatchObject({ refined: true, llmScore: 90 });
  });

  it('미정제 + 상한 미도달이면 다음 라운드 질문이 게시된다', async () => {
    const { runner, port, store } = makeRunner(
      [
        clarificationResponse,
        unrefinedCompletenessResponse,
        clarificationResponse, // 2라운드 질문
      ],
      { maxRounds: 3 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '영업팀 매니저가 봅니다' });

    expect(port.posted.at(-1)?.text).toContain('데이터는 어디에서 가져오면 되나요?');
    expect(result?.status).toBe('clarifying');
    expect(store.findSessionByThreadKey('web:thread-1')).toMatchObject({
      status: 'clarifying',
      roundCount: 2,
    });
  });

  it('상한 도달 + 남은 미충족 슬롯이 전부 승격 가능이면 조건부 문서가 게시된다 (G-9)', async () => {
    const { runner, port, store } = makeRunner(
      [
        clarificationResponse,
        unrefinedCompletenessResponse, // 상한 도달 시점에 purpose·data-source 미충족
        promotableResponse, // 승격 판정 — 둘 다 담당자 몫
        requirementsResponse,
        nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      ],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '영업팀 매니저가 봅니다' });

    expect(result?.status).toBe('documented'); // 보류가 아니라 조건부 상정
    const doc = port.posted.at(-1)?.text ?? '';
    expect(doc).toContain('오픈이슈');
    // 오픈이슈 질문은 담당자가 읽는 문장이다 — 요청자에게 되묻지 않는다
    expect(doc).toContain('매출 집계의 진실 원천으로 어느 저장소를 쓸 것인가');

    expect(store.exportSessions()[0]?.slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotKey: 'purpose', state: 'promoted' }),
        expect.objectContaining({ slotKey: 'data-source', state: 'promoted' }),
      ]),
    );
    const signals = store.exportSessions()[0]?.signals ?? [];
    expect(signals.find((signal) => signal.type === 'promotion_judged')?.payload).toMatchObject({
      promotable: ['purpose', 'data-source'],
      blocking: [],
    });
    expect(signals.find((signal) => signal.type === 'document_delivered')?.payload).toMatchObject({
      conditional: true,
    });
    expect(signals.some((signal) => signal.type === 'session_on_hold')).toBe(false);
  });

  it('상한 도달 + 미충족 슬롯이 없으면 승격 판정 없이 조건부 문서로 간다 (G-9)', async () => {
    const { runner, store, backend } = makeRunner(
      [
        clarificationResponse,
        lowScoreCompletenessResponse, // 룰 층 통과, 루브릭 미달 → 미정제
        requirementsResponse,
        nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      ],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '영업팀 매니저요. CRM이요.' });

    // 「정보 부족」이 아니므로 보류가 아니다 — 남은 것은 해석 모호성이고 왕복은 끝났다
    expect(result?.status).toBe('documented');
    // 승격 판정 호출은 없다 (승격시킬 슬롯이 없다) — 4번째는 문서 뒤 UI 분류 (#54)
    expect(backend.requests).toHaveLength(4);
    const signals = store.exportSessions()[0]?.signals ?? [];
    expect(signals.some((signal) => signal.type === 'promotion_judged')).toBe(false);
    expect(signals.some((signal) => signal.type === 'session_on_hold')).toBe(false);
  });

  it('상한 도달 + 승격 불가 슬롯이 남으면 승격 없이 보류로 종결된다 (F2c ③)', async () => {
    const { runner, store } = makeRunner(
      [clarificationResponse, unrefinedCompletenessResponse, blockingPromotionResponse],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '잘 모르겠는데요' });

    expect(result).toMatchObject({ status: 'closed', terminalState: 'on_hold_insufficient_info' });
    expect(store.exportSessions()[0]?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'promotion_judged' }),
        expect.objectContaining({ type: 'session_on_hold' }),
      ]),
    );
    // 부분 승격은 하지 않는다 — 하나라도 승격 불가면 문서가 근거가 되지 못하므로 상태를 건드리지 않는다
    expect(store.exportSessions()[0]?.slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotKey: 'purpose', state: 'unfilled' }),
        expect.objectContaining({ slotKey: 'data-source', state: 'unfilled' }),
      ]),
    );
  });

  it('승격 판정도 통과하지 못하면 사유 회신이 종결을 앞선다 (원칙 5)', async () => {
    const { runner, port, store } = makeRunner(
      [clarificationResponse, unrefinedCompletenessResponse, blockingPromotionResponse],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '잘 모르겠는데요' });

    const lastPost = port.posted.at(-1)?.text ?? '';
    expect(lastPost).toContain('보류'); // 사유를 담은 회신이 종결을 앞선다
    expect(result).toMatchObject({
      status: 'closed',
      terminalState: 'on_hold_insufficient_info',
    });
    const session = store.findSessionByThreadKey('web:thread-1');
    expect(session).toMatchObject({ status: 'closed', terminalState: 'on_hold_insufficient_info' });
    expect(session?.closedAt).not.toBeNull();
    expect(store.exportSessions()[0]?.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'session_on_hold' })]),
    );
  });

  it('보류(정보 부족) 세션은 입력으로 자동 재개된다 — 정본 전이 보류→명확화 (#30)', async () => {
    const { runner, port, store } = makeRunner(
      [
        clarificationResponse,
        unrefinedCompletenessResponse, // 1차 답변 → 상한 도달
        blockingPromotionResponse, // 승격 불가 → 보류
        unrefinedCompletenessResponse, // 재개 답변 → 미정제
        clarificationResponse, // 재개로 예산이 늘어 다음 라운드 질문
      ],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '잘 모르겠는데요' }); // → 보류 종결

    const result = await runner.handleReply({
      ...intake,
      text: '내용을 보탤게요 — 영업팀용입니다',
    });

    expect(result).toMatchObject({ status: 'clarifying', terminalState: null });
    const session = store.findSessionByThreadKey('web:thread-1');
    expect(session?.closedAt).toBeNull(); // 재개는 종결 흔적을 지운다
    expect(port.posted.at(-1)?.text).toContain('데이터는 어디에서 가져오면 되나요?');
    expect(store.exportSessions()[0]?.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'session_resumed' })]),
    );
  });

  it('documented 세션의 슬롯 확인 — 맞아요는 확인 기록, 아니에요는 정정 재판정 (F3, 상한 미산입)', async () => {
    const { runner, port, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      refinedCompletenessResponse, // 정정 재판정 → 여전히 정제
      requirementsResponse, // 문서 v2
    ]);
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });
    const before = store.findSessionByThreadKey('web:thread-1');
    expect(before?.status).toBe('documented');

    // 맞아요 — 확인이 슬롯 행에 기록된다 (원칙 7 슬롯 단위 확인)
    await runner.confirmSlot(intake, 'target-user', true);
    expect(
      store.exportSessions()[0]?.slotStates.find((slot) => slot.slotKey === 'target-user'),
    ).toMatchObject({ confirmedByRequester: true });

    // 아니에요 + 정정 — 재판정 후 문서가 다시 게시되고, 왕복 상한(roundCount)은 늘지 않는다
    const roundBefore = store.findSessionByThreadKey('web:thread-1')?.roundCount;
    const outcome = await runner.confirmSlot(
      { ...intake, text: '사실 경영진 보고용이에요' },
      'purpose',
      false,
    );
    expect(outcome?.status).toBe('documented');
    // 정정 재생성은 무버전 덮어쓰기가 아니다 — 문서에 vN이 실린다 (G-11)
    expect(port.posted.at(-1)?.text).toContain('requirements 문서 v2');
    expect(store.findSessionByThreadKey('web:thread-1')?.roundCount).toBe(roundBefore);
    const signals = store.exportSessions()[0]?.signals ?? [];
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'slot_confirmed' }),
        expect.objectContaining({ type: 'slot_correction' }),
      ]),
    );
    expect(
      signals
        .filter((signal) => signal.type === 'document_delivered')
        .map((signal) => (signal.payload as { version?: number }).version),
    ).toEqual([1, 2]);
  });

  it('전 슬롯 확인이 끝나면 완주가 세션에 한 번 기록된다 (G-11 — #11 완주율의 분자)', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
    ]);
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });

    const completedSignals = () =>
      store.exportSessions()[0]?.signals.filter((signal) => signal.type === 'session_completed') ??
      [];

    await runner.confirmSlot(intake, 'target-user', true);
    expect(completedSignals()).toHaveLength(0); // purpose가 아직 미확인

    await runner.confirmSlot(intake, 'purpose', true);
    // data-source는 승격 슬롯이라 요청자 확인 대상이 아니다 (문서 오픈이슈로 간다)
    expect(completedSignals()).toHaveLength(1);
    expect(completedSignals()[0]?.payload).toMatchObject({
      confirmedSlotCount: 2,
      promotedSlotCount: 1,
    });

    await runner.confirmSlot(intake, 'target-user', true);
    expect(completedSignals()).toHaveLength(1); // 재확인이 완주를 중복 기록하지 않는다
    expect(completedSignals()[0]?.payload).toMatchObject({ version: 1 });
  });

  it('정정으로 문서가 다시 나오면 완주도 새 버전에서 다시 성립한다 (G-11)', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      refinedCompletenessResponse, // 정정 재판정 → 여전히 정제
      requirementsResponse, // 문서 v2
    ]);
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });
    const completions = () =>
      store
        .exportSessions()[0]
        ?.signals.filter((signal) => signal.type === 'session_completed')
        .map((signal) => (signal.payload as { version?: number }).version) ?? [];

    await runner.confirmSlot(intake, 'target-user', true);
    await runner.confirmSlot(intake, 'purpose', true);
    expect(completions()).toEqual([1]);

    // 정정은 문서를 새로 만들고 확인을 되돌린다 — 완주는 v1에 남고 v2는 아직 아니다
    await runner.confirmSlot({ ...intake, text: '사실 경영진 보고용이에요' }, 'purpose', false);
    expect(completions()).toEqual([1]);

    await runner.confirmSlot(intake, 'target-user', true);
    await runner.confirmSlot(intake, 'purpose', true);
    expect(completions()).toEqual([1, 2]);
  });

  it('문서가 게시마다 구조체로 영속된다 — 정정은 새 버전 행 (#53)', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      refinedCompletenessResponse, // 정정 재판정 → 여전히 정제
      requirementsResponse, // 문서 v2
    ]);
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });
    const session = store.findSessionByThreadKey('web:thread-1');

    const afterFirst = store.listRequirementsDocs(session!.id);
    expect(afterFirst.map((doc) => doc.version)).toEqual([1]);
    // 게시 텍스트는 전달 표면이고 정본은 구조체다 — 역파싱 없이 그대로 읽을 수 있어야 한다
    expect(afterFirst[0]?.content).toMatchObject({
      problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
      users: ['영업팀 매니저'],
    });
    // 승격 슬롯의 오픈이슈 합류(코드 강제)가 영속본에도 반영된다
    expect(
      (afterFirst[0]?.content as { openIssues: Array<{ slotKey: string }> }).openIssues.map(
        (issue) => issue.slotKey,
      ),
    ).toContain('data-source');

    await runner.confirmSlot({ ...intake, text: '사실 경영진 보고용이에요' }, 'purpose', false);
    expect(store.listRequirementsDocs(session!.id).map((doc) => doc.version)).toEqual([1, 2]);
  });

  it('레거시 세션(신호만 있는 문서 이력)의 재생성도 버전을 이어 센다 (#53 정합)', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
    ]);
    await runner.handleIntake(intake);
    // #53 이전 세션의 흔적 재현 — 문서 행 없이 document_delivered 신호만 존재
    const session = store.findSessionByThreadKey('web:thread-1');
    store.recordSignal({
      sessionId: session!.id,
      type: 'document_delivered',
      payload: { version: 1, openIssueCount: 0, conditional: false },
      promptVersionId: session!.promptVersionId,
      modelVersion: session!.modelVersion,
      thresholdVersionId: session!.thresholdVersionId,
      slotSchemaVersionId: session!.slotSchemaVersionId,
    });

    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });

    // 파생 버전(신호 1건)과 정합 — 새 문서는 v1이 아니라 v2로 이어진다
    expect(store.listRequirementsDocs(session!.id).map((doc) => doc.version)).toEqual([2]);
    expect(runner.documentVersionOf(session!.id)).toBe(2);
  });

  it('전면 승격 문서는 확인할 슬롯이 없으므로 게시 시점이 종착이다 (G-11, #28 S-5)', async () => {
    const { runner, store } = makeRunner([
      clarificationResponse,
      fullyPromotedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
    ]);
    await runner.handleIntake(intake);

    const result = await runner.handleReply({ ...intake, text: '전부 모르겠어요' });

    expect(result?.status).toBe('documented');
    const completed = store
      .exportSessions()[0]
      ?.signals.find((signal) => signal.type === 'session_completed');
    // P-U3 — 요청자가 답할 수 없어서 완주에서 빠지는 세션은 없다
    expect(completed?.payload).toMatchObject({
      reason: 'fully_promoted',
      version: 1,
      confirmedSlotCount: 0,
      promotedSlotCount: 3,
    });
  });

  it('정정이 미정제로 판명돼도 문서를 보류로 파괴하지 않고, 상한 미산입 되물음을 연다 (§6)', async () => {
    const { runner, port, store } = makeRunner(
      [
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
        unrefinedCompletenessResponse, // 정정 재판정 → 미정제
        clarificationResponse, // 되물음 라운드 (상한 미산입)
      ],
      { maxRounds: 1 }, // 예산이 이미 소진된 상태에서도 정정은 보류로 흐르지 않아야 한다
    );
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });
    expect(store.findSessionByThreadKey('web:thread-1')?.status).toBe('documented');
    const roundBefore = store.findSessionByThreadKey('web:thread-1')?.roundCount;

    const outcome = await runner.confirmSlot(
      { ...intake, text: '사실 다른 문제예요' },
      'purpose',
      false,
    );

    expect(outcome?.status).toBe('clarifying'); // 보류가 아니라 되물음
    expect(outcome?.terminalState).toBeNull();
    expect(port.posted.at(-1)?.text).toContain('데이터는 어디에서 가져오면 되나요?');
    expect(store.findSessionByThreadKey('web:thread-1')?.roundCount).toBe(roundBefore); // 미산입
  });

  it('documented 세션의 일반 답변은 재판정 없이 정정 경로 안내만 회신한다 (#52 — 채널 무관 가드)', async () => {
    const { runner, port, store } = makeRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
      // 이후 스크립트 없음 — 가드가 뚫려 LLM이 호출되면 ScriptedBackend가 던진다
    ]);
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '영업팀 매니저요. 수작업 집계 제거요.' });
    const before = store.findSessionByThreadKey('web:thread-1');
    expect(before?.status).toBe('documented');

    const outcome = await runner.handleReply({ ...intake, text: '아 참, 로고 색도 바꿔 주세요' });

    // 침묵 대신 안내 — 문서는 다시 만들어지지 않고 왕복 예산도 그대로다
    expect(outcome?.status).toBe('documented');
    expect(port.posted.at(-1)?.text).toContain('항목별 확인·정정');
    const after = store.findSessionByThreadKey('web:thread-1');
    expect(after?.roundCount).toBe(before?.roundCount);
    const signals = store.exportSessions()[0]?.signals ?? [];
    expect(signals.filter((signal) => signal.type === 'document_delivered')).toHaveLength(1);
    // 발화는 보존되고 (원칙 7), 마찰이 신호로 남는다 (F11)
    const texts = store.listUtterances(before!.id).map((u) => u.originalText);
    expect(texts).toContain('아 참, 로고 색도 바꿔 주세요');
    expect(signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'reply_after_documented' })]),
    );
    // 안내는 최종 발화로 남아 미완 라운드로 오인되지 않는다 (G-10 pendingRound)
    expect(runner.pendingRound('web:thread-1')).toBeNull();
  });

  it('openSession/startClarification 분리 — 접수 확인이 먼저, 라운드는 나중에 (G-1)', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);

    const opened = await runner.openSession(intake);
    expect(opened.existing).toBe(false);
    expect(port.posted).toHaveLength(1); // 접수 확인만 — LLM 호출 전
    expect(store.getSession(opened.sessionId)?.status).toBe('intake');

    await runner.startClarification(intake);
    expect(port.posted).toHaveLength(2);
    expect(store.getSession(opened.sessionId)).toMatchObject({
      status: 'clarifying',
      roundCount: 1,
    });
  });

  it('실패한 판정의 재시도는 발화를 다시 기록하지 않고 판정만 다시 수행한다 (G-10)', async () => {
    const script = [clarificationResponse]; // 판정 응답을 준비하지 않아 답변 라운드가 죽는다
    const { runner, store } = makeRunner(script, { maxRounds: 3 });
    await runner.handleIntake(intake);

    await expect(
      runner.handleReply({ ...intake, text: '영업팀 매니저가 봅니다' }),
    ).rejects.toThrow();
    const roundBefore = store.findSessionByThreadKey('web:thread-1')?.roundCount;
    expect(runner.pendingRound('web:thread-1')).toBe('judgement');

    script.push(unrefinedCompletenessResponse, clarificationResponse);
    const outcome = await runner.retryRound({ ...intake, text: '' });

    expect(outcome?.status).toBe('clarifying');
    // 발화는 이미 저장돼 있다 — 재시도가 요청자 발화를 다시 적지 않는다 (#28 S-4)
    expect(
      store
        .exportSessions()[0]
        ?.utterances.filter((u) => u.originalText === '영업팀 매니저가 봅니다'),
    ).toHaveLength(1);
    // 죽은 라운드의 몫만 소모한다 — 재시도가 예산을 추가로 먹지 않는다
    expect(store.findSessionByThreadKey('web:thread-1')?.roundCount).toBe((roundBefore ?? 0) + 1);
    expect(runner.pendingRound('web:thread-1')).toBeNull();
  });

  it('intake 상태의 재시도는 질문 생성만 다시 수행한다 (G-10)', async () => {
    const script: string[] = [];
    const { runner, port, store } = makeRunner(script);
    await runner.openSession(intake);

    await expect(runner.startClarification(intake)).rejects.toThrow();
    expect(runner.pendingRound('web:thread-1')).toBe('clarification');

    script.push(clarificationResponse);
    const outcome = await runner.retryRound({ ...intake, text: '' });

    expect(outcome?.status).toBe('clarifying');
    expect(store.findSessionByThreadKey('web:thread-1')?.roundCount).toBe(1);
    expect(port.posted.at(-1)?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');
    // 접수 확인도 한 번뿐이다 — 재시도가 인테이크를 되돌리지 않는다
    expect(
      store.exportSessions()[0]?.utterances.filter((u) => u.authorType === 'requester'),
    ).toHaveLength(1);
  });

  it('미완 라운드가 없으면 재시도는 아무 것도 하지 않는다 (G-10 멱등)', async () => {
    const { runner, port } = makeRunner([clarificationResponse]);
    await runner.handleIntake(intake);
    const postedBefore = port.posted.length;

    expect(runner.pendingRound('web:thread-1')).toBeNull();
    expect(await runner.retryRound({ ...intake, text: '' })).toBeNull();
    expect(port.posted.length).toBe(postedBefore);
  });

  it('보류로 종결된 세션은 재시도 대상이 아니다 — 재개는 입력으로만 (G-10, #30)', async () => {
    const { runner } = makeRunner(
      [clarificationResponse, unrefinedCompletenessResponse, blockingPromotionResponse],
      { maxRounds: 1 },
    );
    await runner.handleIntake(intake);
    await runner.handleReply({ ...intake, text: '잘 모르겠는데요' });

    expect(runner.pendingRound('web:thread-1')).toBeNull();
    expect(await runner.retryRound({ ...intake, text: '' })).toBeNull();
  });

  it('세션이 없는 threadKey의 답변은 무시한다', async () => {
    const { runner, port, store } = makeRunner([]);

    const result = await runner.handleReply({ ...intake, threadKey: 'web:unknown' });

    expect(result).toBeNull();
    expect(port.posted).toHaveLength(0);
    expect(store.exportSessions()).toHaveLength(0);
  });

  it('보류 외의 종결 세션은 답변을 무시한다 — 재개는 보류(정보 부족) 전용 (#30)', async () => {
    const { runner, port, store } = makeRunner([clarificationResponse]);
    const { sessionId } = await runner.handleIntake(intake);
    // Phase 1 종결 상태(거절 등)를 가정한 가드 회귀 방어
    store.updateSessionState(sessionId, { status: 'closed', terminalState: 'rejected' });

    const postedBefore = port.posted.length;
    const result = await runner.handleReply({ ...intake, text: '추가로요' });

    expect(result).toBeNull();
    expect(port.posted.length).toBe(postedBefore);
    // 종결 후 발화는 세션에 추가 기록되지 않는다
    expect(
      store.exportSessions()[0]?.utterances.filter((u) => u.originalText === '추가로요'),
    ).toEqual([]);
  });
});

describe('코어 러너 — 자료 첨부 (F1-Attach, ADR-0011)', () => {
  it('첨부는 요청자 발화에 붙고, 질문 생성 전에 읽힌다', async () => {
    const { runner, backend, store, stage } = makeAttachmentRunner([clarificationResponse]);
    const uploadId = stage('기획서.txt', '대상 사용자: 영업팀 매니저');

    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [uploadId] });

    const attachments = store.listAttachments(sessionId);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      filename: '기획서.txt',
      extractionStatus: 'ok',
      extractedText: '대상 사용자: 영업팀 매니저',
      extractorVersion: 'text@0.1.0',
    });
    // 첨부는 첫 요청자 발화에 매달린다 — 첨부 시점이 전사 순서로 남는다
    const utterances = store.listUtterances(sessionId);
    expect(attachments[0]?.utteranceId).toBe(utterances[0]?.id);
    // 질문 생성 호출이 자료를 이미 들고 있다
    const clarificationInput = backend.requests[0]?.input as { attachments?: unknown[] };
    expect(clarificationInput.attachments).toEqual([
      { ref: 'A1', filename: '기획서.txt', text: '대상 사용자: 영업팀 매니저' },
    ]);
  });

  it('추출 텍스트는 발화와 구분되어 판정에 실린다 — 요청자가 한 말로 섞이지 않는다', async () => {
    const { runner, backend, stage } = makeAttachmentRunner([
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
    ]);
    const uploadId = stage('메모.txt', '월별 매출 추이가 필요함');
    await runner.handleIntake({ ...intake, uploadIds: [uploadId] });

    await runner.handleReply({ ...intake, text: '영업팀 매니저요' });

    const completenessInput = backend.requests[1]?.input as {
      conversation: Array<{ answer: string }>;
      attachments: Array<{ ref: string; text: string }>;
    };
    expect(completenessInput.attachments).toEqual([
      { ref: 'A1', filename: '메모.txt', text: '월별 매출 추이가 필요함' },
    ]);
    // 자료 내용이 대화 answer로 섞여 들어가지 않는다
    expect(JSON.stringify(completenessInput.conversation)).not.toContain('월별 매출 추이가 필요함');
    // ref → id 매핑은 내부용이라 LLM 입력에 실리지 않는다
    expect(JSON.stringify(backend.requests[1]?.input)).not.toContain('attachmentIdByRef');
  });

  it('첨부에서 읽은 슬롯 값은 출처가 함께 기록된다 (결정 8 — 확인 화면의 근거)', async () => {
    const { runner, store, stage } = makeAttachmentRunner([
      clarificationResponse,
      attachmentEvidenceResponse,
      requirementsResponse,
      nonUiClassificationResponse, // 문서 뒤 UI 분류 — 비 UI라 목업 생략 (#54)
    ]);
    const uploadId = stage('기획서.txt', '대상 사용자: 영업팀 매니저');
    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [uploadId] });

    await runner.handleReply({ ...intake, text: '수작업 집계를 없애고 싶어요' });

    const attachmentId = store.listAttachments(sessionId)[0]?.id;
    const slots = store.listSlotStates(sessionId);
    expect(slots.find((s) => s.slotKey === 'target-user')).toMatchObject({
      state: 'filled',
      evidenceAttachmentId: attachmentId,
    });
    // 대화에서 나온 값에는 첨부 출처가 붙지 않는다
    expect(slots.find((s) => s.slotKey === 'purpose')?.evidenceAttachmentId).toBeNull();
  });

  it('읽지 못한 자료는 라운드를 죽이지 않고 사유와 함께 남는다 (P-U3)', async () => {
    const { runner, port, store, stage } = makeAttachmentRunner([clarificationResponse]);
    const uploadId = stage('빈파일.txt', '   ');

    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [uploadId] });

    expect(store.listAttachments(sessionId)[0]).toMatchObject({
      extractionStatus: 'failed',
      extractionError: '내용이 비어 있다',
      extractedText: null,
    });
    // 질문은 그대로 나갔다 — 자료를 못 읽었다고 여정이 멈추지 않는다
    expect(port.posted[1]?.text).toContain('이 대시보드는 주로 누가 보게 되나요?');
    expect(store.getSession(sessionId)?.status).toBe('clarifying');
  });

  it('추출 성공·실패가 신호로 남고 추출기 버전이 payload에 실린다 (결정 5 — 축은 5축 유지)', async () => {
    const { runner, store, stage } = makeAttachmentRunner([clarificationResponse]);
    const good = stage('본문.txt', '대상 사용자: 영업팀');
    const bad = stage('빈파일.txt', '  ');

    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [good, bad] });

    const types = store.listSignals(sessionId).map((s) => s.type);
    expect(types.filter((t) => t === 'attachment_uploaded')).toHaveLength(2);
    expect(types).toContain('attachment_extracted');
    expect(types).toContain('attachment_extraction_failed');
    const extracted = store
      .listSignals(sessionId)
      .find((s) => s.type === 'attachment_extracted')?.payload;
    expect(extracted).toMatchObject({
      extractorVersion: 'text@0.1.0',
      textLength: '대상 사용자: 영업팀'.length,
    });
  });

  it('답변에 자료를 더 붙여도 왕복 상한을 소비하지 않는다 (§6 계약)', async () => {
    const { runner, store, stage } = makeAttachmentRunner([
      clarificationResponse,
      unrefinedCompletenessResponse,
      clarificationResponse,
    ]);
    const first = stage('a.txt', '첫 자료');
    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [first] });
    const roundsAfterIntake = store.getSession(sessionId)?.roundCount;

    const second = stage('b.txt', '두 번째 자료');
    await runner.handleReply({ ...intake, text: '이것도 참고해 주세요', uploadIds: [second] });

    // 라운드는 답변 때문에 하나 늘 뿐, 첨부가 따로 라운드를 만들지 않는다
    expect(store.getSession(sessionId)?.roundCount).toBe((roundsAfterIntake ?? 0) + 1);
    expect(store.listAttachments(sessionId)).toHaveLength(2);
  });

  it('세션당 첨부 개수 상한을 넘기면 거부한다', async () => {
    const { runner, store, stage } = makeAttachmentRunner([clarificationResponse], {
      limits: { maxPerSession: 1 },
    });
    const first = stage('a.txt', '첫 자료');
    const second = stage('b.txt', '두 번째 자료');

    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [first] });

    await expect(
      runner.handleReply({ ...intake, text: '하나 더요', uploadIds: [second] }),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(store.listAttachments(sessionId)).toHaveLength(1);
  });

  it('세션 텍스트 총량을 넘는 자료는 추출하지 않고 사유를 남긴다 — 조용히 자르지 않는다', async () => {
    const { runner, store, stage } = makeAttachmentRunner([clarificationResponse], {
      limits: { maxSessionTextChars: 10 },
    });
    const small = stage('작은.txt', '짧은자료');
    const big = stage('큰.txt', 'x'.repeat(50));

    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [small, big] });

    const attachments = store.listAttachments(sessionId);
    expect(attachments[0]).toMatchObject({ extractionStatus: 'ok' });
    expect(attachments[1]).toMatchObject({
      extractionStatus: 'failed',
      extractionError: '이 요청에 담을 수 있는 자료 분량을 넘었다',
    });
  });

  it('업로드 검증은 형식과 크기를 업로드 시점에 거른다 (P-U1 — 제출 후에 알게 하지 않는다)', () => {
    const { runner } = makeAttachmentRunner([], { limits: { maxBytesPerFile: 100 } });

    expect(() => runner.validateUpload({ mime: 'text/plain', bytes: 50 })).not.toThrow();
    expect(() => runner.validateUpload({ mime: 'application/zip', bytes: 50 })).toThrow(
      UploadRejectedError,
    );
    expect(() => runner.validateUpload({ mime: 'text/plain', bytes: 500 })).toThrow(
      UploadRejectedError,
    );
    expect(runner.supportedUploadMimes()).toContain('text/plain');
  });

  it('첨부를 다루지 못하는 구성은 업로드를 받아 놓고 버리지 않고 거부한다', async () => {
    const { runner } = makeRunner([clarificationResponse]);

    expect(runner.attachmentsEnabled).toBe(false);
    await expect(
      runner.handleIntake({ ...intake, uploadIds: ['some-upload'] }),
    ).rejects.toBeInstanceOf(UploadRejectedError);
  });

  it('이미 읽은 자료는 다음 라운드에서 다시 읽지 않는다', async () => {
    let calls = 0;
    const counting: Extractor = {
      version: 'counting@0.1.0',
      mimes: ['text/plain'],
      extract(input) {
        calls++;
        return Promise.resolve({ status: 'ok', text: input.bytes.toString('utf8') });
      },
    };
    const { runner, stage } = makeAttachmentRunner(
      [clarificationResponse, unrefinedCompletenessResponse, clarificationResponse],
      { extractor: counting },
    );
    const uploadId = stage('a.txt', '자료 본문');
    await runner.handleIntake({ ...intake, uploadIds: [uploadId] });

    await runner.handleReply({ ...intake, text: '영업팀 매니저요' });

    expect(calls).toBe(1);
  });
});

describe('코어 러너 — 발화 길이 상한 (#58, ADR-0014)', () => {
  it('상한을 넘는 인테이크 발화는 세션을 만들지 않고 안내와 함께 거부한다', async () => {
    const { runner, port, store } = makeRunner([], { maxUtteranceChars: 100 });

    await expect(runner.handleIntake({ ...intake, text: '가'.repeat(101) })).rejects.toThrow(
      UtteranceRejectedError,
    );

    expect(store.findSessionByThreadKey(intake.threadKey)).toBeNull();
    expect(port.posted).toHaveLength(0); // 접수 확인도 나가지 않는다 — 접수 전 거부
  });

  it('상한을 넘는 답변 발화는 저장하지 않고 거부하며, 세션은 계속 답변을 기다린다', async () => {
    const { runner, store } = makeRunner([clarificationResponse], { maxUtteranceChars: 100 });
    await runner.handleIntake(intake);
    const before = store.listUtterances(store.findSessionByThreadKey(intake.threadKey)!.id).length;

    await expect(runner.handleReply({ ...intake, text: '가'.repeat(101) })).rejects.toThrow(
      UtteranceRejectedError,
    );

    const session = store.findSessionByThreadKey(intake.threadKey)!;
    expect(store.listUtterances(session.id)).toHaveLength(before); // 장문 발화 미저장
    expect(session.status).toBe('clarifying');
  });

  it('거부 안내는 요청자 언어로 파일 첨부·링크 대안을 담는다', async () => {
    const { runner } = makeRunner([], { maxUtteranceChars: 100 });

    await expect(runner.handleIntake({ ...intake, text: 'a'.repeat(101) })).rejects.toThrow(
      /attach|link/i,
    );
    await expect(runner.handleIntake({ ...intake, text: '가'.repeat(101) })).rejects.toThrow(
      /첨부|링크/,
    );
  });
});

describe('코어 러너 — 장문 첨부 압축 (#58, ADR-0014)', () => {
  const condensationOf = (text: string) => JSON.stringify({ condensed: text });
  const longText = '대상 사용자: 영업팀 매니저. 월별 매출 추이와 팀별 비교가 필요하다. '.repeat(10).trim();

  it('생성 예산 초과 세션은 장문 첨부가 압축되고 — 판정은 전문, requirements는 표시된 압축본을 받는다', async () => {
    const { runner, backend, store, stage } = makeAttachmentRunner(
      [
        condensationOf('압축된 PRD 핵심'),
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        nonUiClassificationResponse,
      ],
      { condense: { targetChars: 100, budgetChars: 200 } },
    );
    const uploadId = stage('prd.md', longText, 'text/markdown');
    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [uploadId] });
    await runner.handleReply({
      ...intake,
      text: '영업팀 매니저가 봅니다. 수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
    });

    // 압축 호출이 첫 호출로, 원문 전체와 목표 길이를 받는다
    const condensationInput = backend.requests[0]?.input as { text: string; targetChars: number };
    expect(condensationInput.text).toBe(longText);
    expect(condensationInput.targetChars).toBe(100);
    // 판정 호출(명확화·완결성)은 원문 전문을 유지한다 (ADR-0014 결정 1)
    const clarifyInput = backend.requests[1]?.input as { attachments: Array<{ text: string }> };
    expect(clarifyInput.attachments[0]?.text).toBe(longText);
    const completenessInput = backend.requests[2]?.input as { attachments: Array<{ text: string }> };
    expect(completenessInput.attachments[0]?.text).toBe(longText);
    // 생성 호출(requirements)은 압축본을 압축 표시와 함께 받는다 (ADR-0014 결정 2)
    const requirementsInput = backend.requests[3]?.input as { attachments: Array<{ text: string }> };
    expect(requirementsInput.attachments[0]?.text).toContain('압축된 PRD 핵심');
    expect(requirementsInput.attachments[0]?.text).toContain('압축본');
    expect(requirementsInput.attachments[0]?.text).not.toContain(longText);
    // 원문은 그대로, 압축본은 파생물로 저장된다 (ADR-0014 결정 3)
    const row = store.listAttachments(sessionId)[0];
    expect(row?.extractedText).toBe(longText);
    expect(row?.condensedText).toBe('압축된 PRD 핵심');
  });

  it('생성 예산 이내의 세션은 아무것도 압축되지 않는다 — 흔한 경우의 충실도 보존', async () => {
    const { runner, backend, store, stage } = makeAttachmentRunner(
      [
        clarificationResponse,
        refinedCompletenessResponse,
        requirementsResponse,
        nonUiClassificationResponse,
      ],
      { condense: { targetChars: 100, budgetChars: 10_000 } },
    );
    const uploadId = stage('prd.md', longText, 'text/markdown');
    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [uploadId] });
    await runner.handleReply({
      ...intake,
      text: '영업팀 매니저가 봅니다. 수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
    });

    expect(store.listAttachments(sessionId)[0]?.condensedText).toBeNull();
    const requirementsInput = backend.requests[2]?.input as { attachments: Array<{ text: string }> };
    expect(requirementsInput.attachments[0]?.text).toBe(longText);
  });

  it('압축 출력이 목표를 넘으면 1회 재시도하고, 그래도 넘으면 명시 마커와 함께 절단한다', async () => {
    const overlong = 'x'.repeat(200);
    const { runner, backend, store, stage } = makeAttachmentRunner(
      [condensationOf(overlong), condensationOf(overlong), clarificationResponse],
      { condense: { targetChars: 50, budgetChars: 100 } },
    );
    const uploadId = stage('prd.md', longText, 'text/markdown');
    const { sessionId } = await runner.handleIntake({ ...intake, uploadIds: [uploadId] });

    // 압축 2회(원시도+재시도) 후 명확화 — 순서가 곧 검증이다
    expect(backend.requests).toHaveLength(3);
    const row = store.listAttachments(sessionId)[0];
    expect(row?.condensedText?.startsWith('x'.repeat(50))).toBe(true);
    expect(row?.condensedText).toContain('잘렸다');
  });
});

describe('코어 러너 — 노션 커넥터 배선 (#57, ADR-0013)', () => {
  class FakeNotionSource implements NotionPageSource {
    calls: string[] = [];
    constructor(private readonly result: NotionFetchResult) {}
    fetchPage(pageId: string): Promise<NotionFetchResult> {
      this.calls.push(pageId);
      return Promise.resolve(this.result);
    }
  }

  const pageUrl = 'https://app.notion.com/p/prd-39766007e77080c6a0bbc2572c136295?source=copy_link';

  it('발화의 노션 링크가 페치되어 markdown 첨부로 붙고, 추출을 거쳐 명확화 입력에 실린다', async () => {
    const notion = new FakeNotionSource({
      status: 'ok',
      title: 'Live Titles PRD',
      markdown: '# PRD\n대상 사용자: 라이브 운영팀',
    });
    const { runner, backend, store, stage: _stage } = makeAttachmentRunner(
      [clarificationResponse],
      { notion },
    );

    const { sessionId } = await runner.handleIntake({
      ...intake,
      text: `Live Title UA 관리 기능. ${pageUrl}`,
    });

    expect(notion.calls).toEqual(['39766007-e770-80c6-a0bb-c2572c136295']);
    const row = store.listAttachments(sessionId)[0];
    expect(row).toMatchObject({
      filename: 'Live Titles PRD.md',
      mime: 'text/markdown',
      sourceUrl: pageUrl,
      extractionStatus: 'ok',
      extractedText: '# PRD\n대상 사용자: 라이브 운영팀',
    });
    // 페치 산출물이 판정 입력에 첨부로 실린다 — 이후는 F1-Attach 규율 그대로
    const clarifyInput = backend.requests[0]?.input as {
      attachments: Array<{ filename: string; text: string }>;
    };
    expect(clarifyInput.attachments[0]).toMatchObject({
      filename: 'Live Titles PRD.md',
      text: '# PRD\n대상 사용자: 라이브 운영팀',
    });
  });

  it('같은 페이지 링크는 라운드가 거듭돼도 다시 페치되지 않는다', async () => {
    const notion = new FakeNotionSource({ status: 'ok', title: 'PRD', markdown: '# 본문' });
    const { runner } = makeAttachmentRunner([clarificationResponse, unrefinedCompletenessResponse, clarificationResponse], {
      notion,
      maxRounds: 3,
    });

    await runner.handleIntake({ ...intake, text: `기능 요청 ${pageUrl}` });
    await runner.handleReply({ ...intake, text: `다시 봐 주세요 ${pageUrl}` });

    expect(notion.calls).toHaveLength(1);
  });

  it('?v=만 있는 데이터베이스 링크는 사유를 단 실패 첨부로 남는다 — 조용히 무시되지 않는다', async () => {
    const notion = new FakeNotionSource({ status: 'ok', title: '안 옴', markdown: '안 옴' });
    const { runner, store } = makeAttachmentRunner([clarificationResponse], { notion });
    const dbUrl =
      'https://app.notion.com/p/board-38366007e770801b9e00d3a4483310e7?v=29466007e77080659824000c94fa5643';

    const { sessionId } = await runner.handleIntake({ ...intake, text: `백로그: ${dbUrl}` });

    expect(notion.calls).toHaveLength(0); // 페치 시도 자체가 없다
    const row = store.listAttachments(sessionId)[0];
    expect(row?.extractionStatus).toBe('failed');
    expect(row?.extractionError).toContain('페이지 링크');
    expect(row?.sourceUrl).toBe(dbUrl);
  });

  it('페치 실패(미공유 등)는 사유를 단 실패 첨부로 남고 라운드는 계속된다 (P-U3)', async () => {
    const notion = new FakeNotionSource({
      status: 'failed',
      error: '노션 페이지를 찾을 수 없다 — 통합을 공유해 달라',
    });
    const { runner, store, port } = makeAttachmentRunner([clarificationResponse], { notion });

    const { sessionId } = await runner.handleIntake({ ...intake, text: `기능 요청 ${pageUrl}` });

    const row = store.listAttachments(sessionId)[0];
    expect(row?.extractionStatus).toBe('failed');
    expect(row?.extractionError).toContain('공유');
    expect(port.posted.length).toBeGreaterThanOrEqual(2); // 접수 확인 + 질문 — 라운드 생존
  });
});

describe('코어 러너 — 게이트웨이 상한 주입 (#59, ADR-0015)', () => {
  it('deps.llm의 타임아웃 상한이 게이트웨이에 닿는다 — 설정으로 조정 가능한 폭주 방지', async () => {
    const store2 = SessionStore.open(':memory:');
    try {
      const port = new FakePort();
      const backend: LlmBackend = { run: () => new Promise(() => {}) }; // 영원히 무응답
      const runner = new IntakeRunner<string>({
        store: store2,
        backend,
        registry: createDefaultRegistry(),
        modelVersion: 'claude-sonnet-5',
        port,
        llm: { timeoutMs: 25 },
      });

      // 라운드 백그라운드가 게이트웨이 타임아웃으로 죽는다 — 25ms 상한이 적용된 증거
      await expect(runner.handleIntake(intake)).rejects.toThrow(/25ms/);
    } finally {
      store2.close();
    }
  });
});
