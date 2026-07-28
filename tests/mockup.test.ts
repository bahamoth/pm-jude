import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import type { MockupOutput } from '../src/prompts/mockup-v0';
import type { UiClassificationOutput } from '../src/prompts/ui-classification-v0';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { ThemeRegistry } from '../src/mockup/theme-registry';
import {
  IntakeRunner,
  type ChannelPort,
  type RoundPayload,
} from '../src/runner/core-runner';
import { SessionStore } from '../src/store/session-store';
import { refinedCompletenessResponse, requirementsResponse } from './slot-fixture';

/**
 * 목업 반복·디자인 시스템 선정 심 테스트 (#54, F4) — 코어 러너 심에서
 * UI 분류 → 목업 생성 → 어노테이션 반복 → 수렴 → 선정 → 역주입을 검증한다.
 * 검증 대상은 외부 행동뿐이다: 포트 게시·저장 행·신호.
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

class FakePort implements ChannelPort<string> {
  posted: Array<{ address: string; text: string; payload?: RoundPayload }> = [];

  post(address: string, text: string, payload?: RoundPayload): Promise<void> {
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

const uiYesResponse = JSON.stringify({
  isUiRequest: true,
  rationale: '대시보드 화면 신설 — UI 변화를 수반한다',
} satisfies UiClassificationOutput);

const uiNoResponse = JSON.stringify({
  isUiRequest: false,
  rationale: '데이터 정정 요청 — 화면 변화가 없다',
} satisfies UiClassificationOutput);

function mockupResponse(marker: string): string {
  return JSON.stringify({
    html: `<html><body><h1>영업 실적 대시보드</h1><p>${marker}</p><button>기간 선택</button></body></html>`,
    summary: marker,
  } satisfies MockupOutput);
}

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function makeRunner(responses: string[], options?: { maxMockupIterations?: number }) {
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
    themes: ThemeRegistry.withBuiltins(),
    ...(options?.maxMockupIterations !== undefined
      ? { maxMockupIterations: options.maxMockupIterations }
      : {}),
  });
  return { runner, port, backend, store };
}

const intake = {
  address: 'reply-to:thread-1',
  threadKey: 'web:thread-1',
  channel: 'web' as const,
  authorId: 'requester-kim',
  text: '영업 실적 대시보드 하나 만들어 주세요',
};

const answer = { ...intake, text: '영업팀 매니저요. 수작업 집계를 없애고 싶어요.' };

/** 인테이크 → 답변 → 문서 게시까지 통과시킨다. 이후 응답은 분류·목업 몫. */
async function reachDocumented(
  responses: string[],
  options?: { maxMockupIterations?: number },
) {
  const made = makeRunner(
    [clarificationResponse, refinedCompletenessResponse, requirementsResponse, ...responses],
    options,
  );
  await made.runner.handleIntake(intake);
  const outcome = await made.runner.handleReply(answer);
  return { ...made, outcome };
}

function signalTypes(sessions: SessionStore, sessionId: string): string[] {
  return sessions.listSignals(sessionId).map((signal) => signal.type);
}

describe('F4 전제 — UI 분류', () => {
  it('비 UI 요청은 목업 없이 documented에 머물고 분류가 세션·신호에 남는다', async () => {
    const { outcome, store } = await reachDocumented([uiNoResponse]);

    expect(outcome?.status).toBe('documented');
    const session = store.getSession(outcome!.sessionId)!;
    expect(session.isUiRequest).toBe(false);
    expect(store.listMockups(session.id)).toEqual([]);
    expect(signalTypes(store, session.id)).toContain('ui_classified');
  });

  it('UI 요청은 목업 v1이 생성·게시되고 세션이 mockup 상태로 간다', async () => {
    const { outcome, store, port } = await reachDocumented([uiYesResponse, mockupResponse('v1')]);

    expect(outcome?.status).toBe('mockup');
    const session = store.getSession(outcome!.sessionId)!;
    expect(session.isUiRequest).toBe(true);

    const mockups = store.listMockups(session.id);
    expect(mockups.length).toBe(1);
    expect(mockups[0]!.version).toBe(1);
    expect(mockups[0]!.docVersion).toBe(1); // 문서 vN ↔ 목업 vN 매핑 (F4)
    expect(mockups[0]!.html).toContain('영업 실적 대시보드');

    // 포트에 목업 게시 — 어댑터가 URL을 만들 수 있는 구조화 payload가 실린다
    const mockupPost = port.posted.find((entry) => entry.payload?.kind === 'mockup_ready');
    expect(mockupPost).toBeDefined();
    const payload = mockupPost!.payload as Extract<RoundPayload, { kind: 'mockup_ready' }>;
    expect(payload.version).toBe(1);
    expect(payload.themeCandidates.length).toBeGreaterThanOrEqual(2);

    expect(signalTypes(store, session.id)).toContain('mockup_generated');
  });
});

describe('F4 — 어노테이션 반복', () => {
  it('어노테이션이 기록되고 목업 v2가 재생성·게시된다', async () => {
    const { runner, store, port, outcome } = await reachDocumented([
      uiYesResponse,
      mockupResponse('v1'),
      mockupResponse('v2 — 필터 3종 반영'),
    ]);
    const sessionId = outcome!.sessionId;

    const result = await runner.annotateMockup(answer, [
      { text: '필터는 기간·팀·상태 3종이면 좋겠어요', elementRef: '#filters' },
    ]);

    expect(result?.status).toBe('mockup');
    const mockups = store.listMockups(sessionId);
    expect(mockups.length).toBe(2);
    expect(mockups[1]!.version).toBe(2);
    expect(mockups[1]!.html).toContain('v2');

    const annotations = store.listMockupAnnotations(sessionId);
    expect(annotations.length).toBe(1);
    expect(annotations[0]!.mockupId).toBe(mockups[0]!.id); // 코멘트는 그 판에 붙는다
    expect(annotations[0]!.elementRef).toBe('#filters');

    // 원문 보존 (원칙 7) — 어노테이션도 전사에 남는다
    const utterances = store.listUtterances(sessionId);
    expect(utterances.some((u) => u.originalText.includes('필터는 기간·팀·상태'))).toBe(true);

    const types = signalTypes(store, sessionId);
    expect(types).toContain('mockup_annotated');
    expect(types.filter((type) => type === 'mockup_generated').length).toBe(2);

    // 새 판 게시가 포트로 나갔다
    const posts = port.posted.filter((entry) => entry.payload?.kind === 'mockup_ready');
    expect(posts.length).toBe(2);
  });

  it('반복 상한 도달 시 재생성 없이 에스컬레이션 — 미수렴 표기와 사유 회신 (원칙 5)', async () => {
    const { runner, store, port, outcome } = await reachDocumented(
      [uiYesResponse, mockupResponse('v1'), mockupResponse('v2')],
      { maxMockupIterations: 1 },
    );
    const sessionId = outcome!.sessionId;

    await runner.annotateMockup(answer, [{ text: '표를 카드로 바꿔 주세요' }]); // 반복 1 — 예산 소진
    const postCountBefore = port.posted.length;
    const result = await runner.annotateMockup(answer, [{ text: '더 화려하게' }]);

    expect(result?.status).toBe('documented'); // 루프 종료 — 세션은 문서 상태로 복귀
    expect(store.listMockups(sessionId).length).toBe(2); // 재생성 없음
    expect(store.latestMockup(sessionId)?.convergence).toBe('escalated');
    expect(signalTypes(store, sessionId)).toContain('mockup_escalated');
    // 침묵 종료가 아니다 — 사유가 요청자에게 회신된다
    expect(port.posted.length).toBeGreaterThan(postCountBefore);
    // 상한 뒤에 남긴 코멘트도 기록은 된다 — 판독 큐(F13)의 몫으로 남는다
    expect(store.listMockupAnnotations(sessionId).length).toBe(2);
  });

  it('mockup 상태에서도 슬롯 정정 진입점이 유지된다 (#51, US-16)', async () => {
    const { runner, store, outcome } = await reachDocumented([
      uiYesResponse,
      mockupResponse('v1'),
      refinedCompletenessResponse, // 정정 재판정 → 여전히 정제
      requirementsResponse, // 문서 v2 — 재분류 없음 (isUiRequest 기록됨)
    ]);
    const sessionId = outcome!.sessionId;

    const result = await runner.confirmSlot(
      { ...answer, text: '사실 대상은 영업사원 본인이에요' },
      'target-user',
      false,
    );

    // 정정으로 문서 v2가 나오고, 목업 루프는 재생성 없이 이어진다
    expect(result?.status).toBe('mockup');
    expect(store.listRequirementsDocs(sessionId).length).toBe(2);
    expect(store.listMockups(sessionId).length).toBe(1);
  });

  it('mockup 상태의 일반 답변은 재판정 없이 안내로 멈춘다 (#52와 대칭)', async () => {
    const { runner, store, outcome } = await reachDocumented([
      uiYesResponse,
      mockupResponse('v1'),
    ]);

    const result = await runner.handleReply({ ...answer, text: '그런데 로그인도 바꿔 주세요' });

    expect(result?.status).toBe('mockup'); // 상태 불변 — 문서 재생성 없음
    expect(store.listMockups(outcome!.sessionId).length).toBe(1);
    expect(signalTypes(store, outcome!.sessionId)).toContain('reply_after_documented');
  });
});

describe('F4 — 디자인 시스템 선정과 역주입', () => {
  const backInjectedResponse = JSON.stringify({
    problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
    users: ['영업팀 매니저'],
    scope: { inScope: ['월별 매출 추이 조회', '필터 3종(기간·팀·상태)'], outOfScope: [] },
    stories: [
      {
        story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
            gwt: {
              given: '매출 데이터가 존재할 때',
              when: '기간을 선택하면',
              then: '월별 합계가 표시된다',
            },
          },
        ],
      },
    ],
    dataSources: [],
    openIssues: [],
  });

  it('테마 1택이 최신 목업에 기록되고 신호로 남는다', async () => {
    const { runner, store, port, outcome } = await reachDocumented([
      uiYesResponse,
      mockupResponse('v1'),
    ]);
    const sessionId = outcome!.sessionId;
    const candidate = runner.themeCandidates()[0]!;

    const result = await runner.selectMockupTheme(answer, { themeId: candidate.id });

    expect(result?.status).toBe('mockup');
    const latest = store.latestMockup(sessionId)!;
    expect(latest.selectedTheme).toBe(candidate.id);
    expect(latest.themeDelegated).toBe(false);
    expect(signalTypes(store, sessionId)).toContain('design_system_selected');
    expect(port.posted.at(-1)?.text).toContain(candidate.name);
  });

  it('없는 테마 id는 거부된다 — null 반환, 기록 없음', async () => {
    const { runner, store, outcome } = await reachDocumented([uiYesResponse, mockupResponse('v1')]);

    const result = await runner.selectMockupTheme(answer, { themeId: 'no-such-theme' });

    expect(result).toBeNull();
    expect(store.latestMockup(outcome!.sessionId)?.selectedTheme).toBeNull();
  });

  it('「개발팀에 맡길게요」 위임도 1클릭으로 기록된다 (승격과 같은 정신)', async () => {
    const { runner, store, outcome } = await reachDocumented([uiYesResponse, mockupResponse('v1')]);

    const result = await runner.selectMockupTheme(answer, { delegated: true });

    expect(result?.status).toBe('mockup');
    const latest = store.latestMockup(outcome!.sessionId)!;
    expect(latest.selectedTheme).toBeNull();
    expect(latest.themeDelegated).toBe(true);
  });

  it('테마 결정 전의 승인은 거부된다 — 시각 방향 없이 역주입하지 않는다', async () => {
    const { runner, outcome, store } = await reachDocumented([uiYesResponse, mockupResponse('v1')]);

    const result = await runner.approveMockup(answer);

    expect(result).toBeNull();
    expect(store.listRequirementsDocs(outcome!.sessionId).length).toBe(1);
  });

  it('승인 → 역주입: requirements v2가 목업 귀속·시각 방향과 함께 영속되고 목업은 approved', async () => {
    const { runner, store, port, outcome } = await reachDocumented([
      uiYesResponse,
      mockupResponse('v1'),
      mockupResponse('v2 — 필터 3종 반영'),
      backInjectedResponse,
    ]);
    const sessionId = outcome!.sessionId;
    await runner.annotateMockup(answer, [{ text: '필터는 기간·팀·상태 3종이면 좋겠어요' }]);
    const candidate = runner.themeCandidates()[1]!;
    await runner.selectMockupTheme(answer, { themeId: candidate.id });

    const result = await runner.approveMockup(answer);

    expect(result?.status).toBe('documented');
    const docs = store.listRequirementsDocs(sessionId);
    expect(docs.length).toBe(2);
    const v2 = docs[1]!;
    expect(v2.version).toBe(2);
    // 역주입 귀속 — 문서 v2는 승인된 목업에서 나왔다 (back_injected_from)
    expect(v2.backInjectedFrom).toBe(store.latestMockup(sessionId)!.id);
    // 확정된 시각 방향은 코드가 보장한다 — 프롬프트 산출물이 아니다 (원칙 2)
    const content = v2.content as { visualDirection?: { themeId: string | null; delegated: boolean } };
    expect(content.visualDirection?.themeId).toBe(candidate.id);
    expect(content.visualDirection?.delegated).toBe(false);

    expect(store.latestMockup(sessionId)?.convergence).toBe('approved');
    const types = signalTypes(store, sessionId);
    expect(types).toContain('mockup_approved');
    // 문서 v2가 요청자에게 게시된다
    expect(port.posted.at(-1)?.text).toContain('requirements 문서 v2');
  });
});
