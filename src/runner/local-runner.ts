import type { LlmBackend } from '../gateway/backend';
import { LlmGateway, type UsageLogger } from '../gateway/gateway';
import { CLARIFICATION_V0 } from '../prompts/catalog';
import type { ClarificationOutput } from '../prompts/clarification-v0';
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

export interface RunnerDeps {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  usageLogger?: UsageLogger;
}

export interface IntakeInput {
  request: string;
  requesterLanguage: string;
  channel: 'web' | 'slack';
}

export interface ClarificationRunResult {
  sessionId: string;
  interpretations: string[];
  questions: ClarificationOutput['questions'];
}

/** 카탈로그의 프롬프트 버전과 임시 임계치·슬롯 스키마를 DB 버전 레지스트리에 아이덤포턴트하게 동기화한다. */
function ensureVersionAxes(store: SessionStore, registry: PromptRegistry) {
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
    store.findVersionId('threshold', 'completeness-rubric', '0.0.0') ??
    store.registerThresholdVersion({
      name: 'completeness-rubric',
      semver: '0.0.0',
      bodyRef: '미정 — 완결성 판정(#6)에서 도입',
      regressionPassed: false,
    });
  const slotSchemaVersionId =
    store.findVersionId('slot_schema', 'temp-required-slots', '0.0.0') ??
    store.registerSlotSchemaVersion({
      name: 'temp-required-slots',
      semver: '0.0.0',
      bodyRef: 'src/runner/local-runner.ts',
      regressionPassed: false,
      slots: TEMP_REQUIRED_SLOTS,
      derivedFrom: [], // 임시 목록 — 실측 근거는 #10에서 합류
    });
  return { promptVersionId, thresholdVersionId, slotSchemaVersionId };
}

/**
 * 인테이크 1회 실행: 세션 생성 → 원문 기록 → 명확화 질문 생성 → 슬롯·신호 기록.
 * 모든 산출이 저장소에 버전 귀속으로 영속된다 — 실행이 끝나도 세션은 export 가능하게 남는다.
 */
export async function runClarificationSession(
  deps: RunnerDeps,
  input: IntakeInput,
): Promise<ClarificationRunResult> {
  const versionAxes = ensureVersionAxes(deps.store, deps.registry);
  const session = deps.store.createSession({
    originChannel: input.channel,
    modelVersion: deps.modelVersion,
    ...versionAxes,
  });
  deps.store.appendUtterance({
    sessionId: session.id,
    authorType: 'requester',
    channel: input.channel,
    originalText: input.request,
    originalLanguage: input.requesterLanguage,
  });

  const gateway = new LlmGateway({
    backend: deps.backend,
    registry: deps.registry,
    ...(deps.usageLogger ? { usageLogger: deps.usageLogger } : {}),
  });
  const result = await gateway.complete<ClarificationOutput>(CLARIFICATION_V0, {
    request: input.request,
    requesterLanguage: input.requesterLanguage,
    requiredSlots: TEMP_REQUIRED_SLOTS.map((slot) => ({ ...slot, state: 'unfilled' })),
  });

  for (const question of result.output.questions) {
    if (question.target.type === 'slot') {
      deps.store.setSlotState({
        sessionId: session.id,
        slotKey: question.target.slotKey,
        state: 'unfilled',
      });
    }
  }
  deps.store.recordSignal({
    sessionId: session.id,
    type: 'clarification_round',
    payload: { questionCount: result.output.questions.length },
    modelVersion: deps.modelVersion,
    ...versionAxes,
  });

  return {
    sessionId: session.id,
    interpretations: result.output.interpretations,
    questions: result.output.questions,
  };
}
