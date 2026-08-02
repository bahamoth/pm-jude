import { afterEach, describe, expect, it } from 'vitest';
import { LlmGateway } from '../src/gateway/gateway';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import {
  CLARIFICATION_V0,
  COMPLETENESS_V0,
  createDefaultRegistry,
  REQUIREMENTS_V0,
} from '../src/prompts/catalog';
import type { ClarificationOutput } from '../src/prompts/clarification-v0';
import {
  judgeCompleteness,
  runRuleLayer,
  type CompletenessOutput,
} from '../src/prompts/completeness-v0';
import {
  assembleRequirementsDocument,
  type RequirementsOutput,
} from '../src/prompts/requirements-v0';
import { SessionStore } from '../src/store/session-store';

/**
 * 조립 smoke test — 실제 모듈(카탈로그 레지스트리·게이트웨이·SQLite 저장소)을 실제 조합으로
 * 관통한다. LLM 백엔드만 대체한다(외부 경계). 개별 행위 검증은 각 시임 테스트의 몫이고,
 * 여기서는 배선이 끊기지 않았는지만 본다.
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

const clarificationResponse = JSON.stringify({
  interpretations: ['관리자용 실적 대시보드', '영업사원 개인 대시보드'],
  questions: [
    {
      question: '이 대시보드는 주로 누가 보게 되나요?',
      target: { type: 'slot', slotKey: 'target-user' },
      exampleOptions: ['영업팀 매니저', '영업사원 본인'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '어떤 질문에 답할 수 있어야 하나요?',
      target: { type: 'ambiguity', description: '실적의 구체적 의미' },
      exampleOptions: ['월별 매출 추이', '계약 건수'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '데이터는 어디에서 가져오면 되나요?',
      target: { type: 'slot', slotKey: 'data-source' },
      exampleOptions: ['CRM', '사내 DB'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
  ],
} satisfies ClarificationOutput);

const completenessResponse = JSON.stringify({
  slots: [
    {
      slotKey: 'target-user',
      verdict: 'filled',
      rationale: '요청자가 「영업팀 매니저」라고 확답함',
    },
    {
      slotKey: 'data-source',
      verdict: 'promoted',
      rationale: '요청자가 「모르겠어요 — 개발팀이 정해 주세요」 경로를 택함',
    },
  ],
  remainingAmbiguities: [],
  rubric: { score: 85, rationale: '핵심 슬롯이 모두 충족 또는 승격됨' },
} satisfies CompletenessOutput);

const requirementsResponse = JSON.stringify({
  problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
  users: ['영업팀 매니저'],
  scope: { inScope: ['월별 매출 추이 조회'], outOfScope: [] },
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
  diagrams: [],
} satisfies RequirementsOutput);

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

describe('Phase 0 조립 smoke', () => {
  it('인테이크 → 명확화 호출 → 슬롯·신호 기록 → export가 한 세션으로 관통된다', async () => {
    store = SessionStore.open(':memory:');
    const registry = createDefaultRegistry();
    const clarification = registry.get(CLARIFICATION_V0);

    // 세션은 카탈로그의 실제 프롬프트 버전에 귀속된다
    const promptVersionId = store.registerPromptVersion({
      name: clarification.name,
      semver: clarification.semver,
      bodyRef: 'src/prompts/clarification-v0.ts',
      regressionPassed: clarification.regressionPassed,
    });
    const versionAxes = {
      promptVersionId,
      modelVersion: 'claude-sonnet-5',
      thresholdVersionId: store.registerThresholdVersion({
        name: 'completeness-rubric',
        semver: '0.1.0',
        bodyRef: 'docs/thresholds/v0.md',
        regressionPassed: false,
      }),
      slotSchemaVersionId: store.registerSlotSchemaVersion({
        name: 'required-slots',
        semver: '0.1.0',
        bodyRef: 'docs/slots/v0.md',
        regressionPassed: false,
        slots: [{ key: 'target-user' }, { key: 'data-source' }],
        derivedFrom: [],
      }),
    };
    const session = store.createSession({ originChannel: 'slack', ...versionAxes });
    const utterance = store.appendUtterance({
      sessionId: session.id,
      authorType: 'requester',
      channel: 'slack',
      originalText: '영업 실적 대시보드 하나 만들어 주세요',
      originalLanguage: 'ko',
    });

    // 게이트웨이는 저장소에서 조립한 컨텍스트를 무상태로 주입받는다 (F14)
    const backend = new ScriptedBackend([
      clarificationResponse,
      completenessResponse,
      requirementsResponse,
    ]);
    const gateway = new LlmGateway({ backend, registry });
    const result = await gateway.complete<ClarificationOutput>(CLARIFICATION_V0, {
      request: utterance.originalText,
      requesterLanguage: 'ko',
      requiredSlots: [
        { key: 'target-user', label: '대상 사용자', state: 'unfilled' },
        { key: 'data-source', label: '데이터 소스', state: 'unfilled' },
      ],
    });

    // 질문이 겨냥한 공백 슬롯과 신호를 세션에 기록
    for (const question of result.output.questions) {
      if (question.target.type === 'slot') {
        store.setSlotState({
          sessionId: session.id,
          slotKey: question.target.slotKey,
          state: 'unfilled',
        });
      }
    }
    store.recordSignal({
      sessionId: session.id,
      type: 'clarification_round',
      payload: { questionCount: result.output.questions.length },
      ...versionAxes,
    });

    // 명확화 결과: target-user는 충족, data-source는 요청자 해소 불가 → 승격 (F2c)
    store.setSlotState({
      sessionId: session.id,
      slotKey: 'target-user',
      state: 'filled',
      value: { answer: '영업팀 매니저' },
      confirmedByRequester: true,
    });
    store.setSlotState({
      sessionId: session.id,
      slotKey: 'data-source',
      state: 'promoted',
      openIssueAssignee: 'dev-lead',
    });

    // 2층 완결성 판정: LLM 층(슬롯 3상태 + 루브릭) → 룰 층(결정론적 백스톱) → 결합 (F2c)
    const requiredSlots = [{ key: 'target-user' }, { key: 'data-source' }];
    const completenessResult = await gateway.complete<CompletenessOutput>(COMPLETENESS_V0, {
      request: utterance.originalText,
      teamLanguage: 'ko',
      requiredSlots,
      conversation: [
        { question: '누가 보나요?', answer: '영업팀 매니저요', slotKey: 'target-user' },
      ],
    });
    const verdict = judgeCompleteness({
      rule: runRuleLayer({ requiredSlots, slotStates: store.listSlotStates(session.id) }),
      llm: completenessResult.output,
    });
    store.recordSignal({
      sessionId: session.id,
      type: 'completeness_check',
      payload: { refined: verdict.refined, llmScore: verdict.llmScore },
      ...versionAxes,
    });
    expect(verdict.refined).toBe(true); // 정제 완료 — requirements 생성으로 진행 가능

    // requirements 생성 → 코드 강제 조립 (승격 슬롯 오픈이슈 합류 + 원문 전사 첨부)
    const reqResult = await gateway.complete<RequirementsOutput>(REQUIREMENTS_V0, {
      request: utterance.originalText,
      teamLanguage: 'ko',
      promotedSlots: [{ key: 'data-source', question: '실적의 진실 원천 테이블은 무엇인가?' }],
    });
    const doc = assembleRequirementsDocument({
      output: reqResult.output,
      promotedSlots: store
        .listSlotStates(session.id)
        .filter((s) => s.state === 'promoted')
        .map((s) => ({
          slotKey: s.slotKey,
          openIssueAssignee: s.openIssueAssignee,
          question: '실적의 진실 원천 테이블은 무엇인가?',
        })),
      utterances: store.listUtterances(session.id).map((u) => ({
        seq: u.seq,
        authorType: u.authorType,
        originalText: u.originalText,
        originalLanguage: u.originalLanguage,
      })),
    });

    // 조립 확인: 프롬프트 본문이 백엔드에 닿았고, 문서와 export에 전 과정이 남는다
    expect(backend.requests[0]?.promptBody).toBe(clarification.body);
    expect(backend.requests[1]?.promptBody).toBe(registry.get(COMPLETENESS_V0).body);
    expect(backend.requests[2]?.promptBody).toBe(registry.get(REQUIREMENTS_V0).body);
    expect(doc.content.openIssues).toEqual([
      {
        slotKey: 'data-source',
        question: '실적의 진실 원천 테이블은 무엇인가?',
        assignee: 'dev-lead',
      },
    ]);
    expect(doc.originalTranscript).toEqual([
      {
        seq: 1,
        authorType: 'requester',
        originalText: '영업 실적 대시보드 하나 만들어 주세요',
        originalLanguage: 'ko',
      },
    ]);
    const exported = store.exportSessions();
    expect(exported[0]).toMatchObject({
      session: { id: session.id, promptVersionId },
      utterances: [{ originalText: '영업 실적 대시보드 하나 만들어 주세요' }],
      slotStates: [
        { slotKey: 'data-source', state: 'promoted', openIssueAssignee: 'dev-lead' },
        { slotKey: 'target-user', state: 'filled', confirmedByRequester: true },
      ],
      signals: [
        { type: 'clarification_round', payload: { questionCount: 3 } },
        { type: 'completeness_check', payload: { refined: true, llmScore: 85 } },
      ],
    });
  });
});
