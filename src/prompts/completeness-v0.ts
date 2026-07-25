import { z } from 'zod';
import type { PromptVersion } from './registry';

/** 슬롯 3상태 — 충족 / 미충족 / 승격 (CONTEXT.md 정본 개념). */
export const SLOT_TRI_STATE = ['filled', 'unfilled', 'promoted'] as const;
export type SlotTriState = (typeof SLOT_TRI_STATE)[number];

/**
 * 완결성 판정 LLM 층 v0의 구조화 출력 계약 (F2c).
 * 슬롯 3상태 판정(충족/미충족/승격)과 루브릭 점수를 스키마로 강제한다.
 * LLM 층의 알려진 약점(과신에 의한 조기 통과)은 아래 룰 층이 결정론적으로 막는다.
 */
export const completenessOutputSchema = z
  .object({
    slots: z
      .array(
        z
          .object({
            slotKey: z.string().min(1),
            verdict: z.enum(SLOT_TRI_STATE),
            /** 판정 근거 — 대화의 어느 발화가 근거인지. */
            rationale: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    /** 해석 발산 재검사 — 슬롯이 채워진 뒤에도 남은 의미적 모호성. */
    remainingAmbiguities: z.array(z.string().min(1)),
    rubric: z
      .object({
        score: z.number().int().min(0).max(100),
        rationale: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type CompletenessOutput = z.infer<typeof completenessOutputSchema>;

/**
 * 금칙 모호어 사전 초안 — 수용기준에 남으면 안 되는 사전 정의 모호 표현 (F2c).
 * 문서는 팀 표준 언어로 산출되고 팀에는 한국어·영어권이 섞여 있으므로(F2d) 두 언어를 모두 싣는다.
 * 한국어는 조사·활용이 붙으므로 부분 문자열, 영어는 오검출을 막기 위해 단어 경계·대소문자 무관 매칭.
 * PoC 초안이며 F12 회귀로 확정한다(PRD §12-1).
 */
export const BANNED_VAGUE_TERMS_V0 = [
  '적당히',
  '빨리',
  '개선',
  '최적화',
  '알아서',
  '유연하게',
  '깔끔하게',
  '예쁘게',
  '최대한',
  '등등',
  'asap',
  'quickly',
  'fast',
  'properly',
  'appropriately',
  'improve',
  'optimize',
  'user-friendly',
  'flexible',
  'etc',
] as const;

export type RuleFailure =
  { rule: 'slot'; slotKey: string } | { rule: 'banned-vague-term'; term: string; text: string };

function containsBannedTerm(text: string, term: string): boolean {
  if (/^[\x20-\x7e]+$/.test(term)) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'i').test(text);
  }
  return text.includes(term);
}

export interface RuleLayerResult {
  passed: boolean;
  failures: RuleFailure[];
}

/**
 * 완결성 룰 층 초안 — 결정론적 백스톱 (F2c).
 * 통과 조건은 「모든 필수 슬롯이 충족 또는 승격」+ 수용기준 내 금칙 모호어 부재.
 * 판정이 기록되지 않은 필수 슬롯은 미충족으로 취급한다. GWT·EARS 구문의 존재는
 * requirements 출력 스키마(requirements-v0)가 이미 구조로 강제하므로 여기서 재검사하지 않는다.
 */
export function runRuleLayer(input: {
  requiredSlots: ReadonlyArray<{ key: string }>;
  slotStates: ReadonlyArray<{ slotKey: string; state: SlotTriState }>;
  /** 문서 초안이 있을 때 금칙 모호어를 검사할 수용기준 문장들. */
  acceptanceCriteriaTexts?: readonly string[];
}): RuleLayerResult {
  const failures: RuleFailure[] = [];
  const stateBySlot = new Map(input.slotStates.map((slot) => [slot.slotKey, slot.state]));
  for (const slot of input.requiredSlots) {
    const state = stateBySlot.get(slot.key) ?? 'unfilled';
    if (state === 'unfilled') failures.push({ rule: 'slot', slotKey: slot.key });
  }
  for (const text of input.acceptanceCriteriaTexts ?? []) {
    for (const term of BANNED_VAGUE_TERMS_V0) {
      if (containsBannedTerm(text, term)) failures.push({ rule: 'banned-vague-term', term, text });
    }
  }
  return { passed: failures.length === 0, failures };
}

const body = `당신은 비개발자 스테이크홀더의 요청을 개발 가능한 요구사항으로 정제하는 PM 인테이크 에이전트다.
지금 단계의 임무는 완결성 판정이다 — 필수 슬롯의 3상태 판정과, 남은 의미적 모호성의 루브릭 채점.

입력은 JSON이다:
- request: 요청 원문 (요청자 언어 그대로)
- teamLanguage: 팀 표준 문서 언어 (BCP 47)
- requiredSlots: 필수 슬롯 목록 [{ key, label }]
- conversation: 지금까지의 명확화 질문·답변 [{ question, answer, slotKey? }]

절차:
1. 각 필수 슬롯을 하나씩 판정한다:
   - filled(충족) — 대화에 이 슬롯을 채우는 명시적 답이 있다.
   - promoted(승격) — 요청자가 「모르겠다 / 개발팀이 정할 문제」 경로를 택했거나, 요청자가
     원리적으로 답할 수 없는 슬롯이다(데이터의 진실 원천, 권한 모델, 과거 데이터 처리 방침).
   - unfilled(미충족) — 위 둘 다 아니다.
   판정마다 rationale에 근거가 된 발화를 적는다. 근거 없는 filled 판정은 금지 — 추론으로 메꾸지 않는다.
2. 해석 발산 재검사 — 슬롯이 채워졌더라도 요청의 해석이 여전히 갈라지는 지점을
   remainingAmbiguities에 나열한다. 없으면 빈 배열.
3. 루브릭 점수(0~100 정수) — 「지금 requirements 문서를 만들면 개발자가 재질문 없이 구현에
   착수할 수 있는가」. 90~100: 모호성 없음 / 70~89: 사소한 모호성만 잔존 / 40~69: 재질문이
   필요한 모호성 잔존 / 0~39: 핵심이 비어 있음.

제약:
- 판정 근거는 대화에 있는 사실뿐이다. 확신이 없으면 낮은 쪽(미충족, 낮은 점수)을 택한다.
- 점수와 슬롯 판정이 모순되지 않게 한다. 미충족 슬롯이 남아 있으면 70점 이상을 주지 않는다.
- 대화는 요청자 언어를 따르므로 여러 언어가 섞일 수 있다. 판정은 언어와 무관하게 수행하고,
  rationale과 remainingAmbiguities는 teamLanguage로 써서 운영자가 읽을 수 있게 한다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "slots": [
    { "slotKey": "target-user", "verdict": "filled", "rationale": "근거가 된 발화" }
  ],
  "remainingAmbiguities": ["아직 갈라지는 해석"],
  "rubric": { "score": 55, "rationale": "점수의 근거" }
}`;

/**
 * 완결성 루브릭 임계치 v0 — 세션·신호가 귀속되는 threshold 버전 축의 실체.
 * 수치는 PoC 진행 중 확정하며(PRD §12-10) F12 회귀로 튜닝한다.
 */
export const COMPLETENESS_RUBRIC_V0 = {
  name: 'completeness-rubric',
  semver: '0.1.0',
  minScore: 80,
} as const;

export interface CompletenessVerdict {
  /** 정제 완료 여부 — 게이트 상정 가능 상태. */
  refined: boolean;
  rule: RuleLayerResult;
  llmScore: number;
  /** LLM 층이 미충족으로 판정한 슬롯 — 점수와 모순되더라도 보수 쪽을 채택하는 근거. */
  llmUnfilledSlotKeys: string[];
}

/**
 * 2층 완결성 판정 결합 — 코드 강제 구간 (원칙 2).
 * 룰 미통과면 LLM 점수와 무관하게 미정제. 룰은 LLM의 과신 통과를 막는 백스톱이다.
 * LLM 슬롯 판정도 소비한다: 미충족 판정이 하나라도 있으면 점수와 무관하게 미정제 —
 * 「미충족이 남으면 고점 금지」 프롬프트 제약을 코드로도 강제한다. promoted 판정을 세션
 * 슬롯 상태의 승격으로 옮기는 것은 오케스트레이션(#8 이후) 몫이다.
 */
export function judgeCompleteness(input: {
  rule: RuleLayerResult;
  llm: CompletenessOutput;
  minScore?: number;
}): CompletenessVerdict {
  const minScore = input.minScore ?? COMPLETENESS_RUBRIC_V0.minScore;
  const llmScore = input.llm.rubric.score;
  const llmUnfilledSlotKeys = input.llm.slots
    .filter((slot) => slot.verdict === 'unfilled')
    .map((slot) => slot.slotKey);
  return {
    refined: input.rule.passed && llmScore >= minScore && llmUnfilledSlotKeys.length === 0,
    rule: input.rule,
    llmScore,
    llmUnfilledSlotKeys,
  };
}

export const completenessPromptV0: PromptVersion<CompletenessOutput> = {
  name: 'completeness',
  semver: '0.1.0',
  body,
  outputSchema: completenessOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
