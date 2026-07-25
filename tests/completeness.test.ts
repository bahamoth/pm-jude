import { describe, expect, it } from 'vitest';
import { COMPLETENESS_V0, createDefaultRegistry } from '../src/prompts/catalog';
import {
  completenessOutputSchema,
  COMPLETENESS_RUBRIC_V0,
  judgeCompleteness,
  runRuleLayer,
} from '../src/prompts/completeness-v0';
import { TEMP_REQUIRED_SLOTS } from '../src/runner/local-runner';

/** 스키마를 통과하는 기준 출력 — red 테스트들은 여기서 한 요소씩 무너뜨린다. */
function validOutput() {
  return {
    slots: [
      {
        slotKey: 'target-user',
        verdict: 'filled',
        rationale: '요청자가 「영업팀 매니저가 봅니다」라고 답함',
      },
      {
        slotKey: 'data-source',
        verdict: 'promoted',
        rationale: '요청자가 「모르겠어요 — 개발팀이 정해 주세요」 경로를 택함',
      },
      {
        slotKey: 'purpose',
        verdict: 'unfilled',
        rationale: '어떤 질문에 답하려는 대시보드인지 아직 답이 없음',
      },
    ],
    remainingAmbiguities: ['「실적」이 매출 금액인지 계약 건수인지 갈라짐'],
    rubric: {
      score: 55,
      rationale: '핵심 슬롯 하나가 비어 있고 실적의 의미가 미해소',
    },
  };
}

describe('완결성 판정 프롬프트 v0 (LLM 층)', () => {
  it('기본 카탈로그에 completeness@0.1.0으로 등록되어 있다', () => {
    const registry = createDefaultRegistry();
    const version = registry.get(COMPLETENESS_V0);

    expect(version.name).toBe('completeness');
    expect(version.body.length).toBeGreaterThan(0);
    expect(version.regressionPassed).toBe(false); // F12 — 회귀 통과 전
    expect(version.outputSchema).toBe(completenessOutputSchema);
  });

  it('기준 출력이 스키마를 통과한다', () => {
    const parsed = completenessOutputSchema.parse(validOutput());
    expect(parsed.slots).toHaveLength(3);
  });

  it('3상태(filled/unfilled/promoted) 밖의 슬롯 판정은 거부한다 (F2c)', () => {
    const output = validOutput();
    output.slots[0]!.verdict = 'partially-filled';
    expect(() => completenessOutputSchema.parse(output)).toThrow();
  });

  it('판정 근거(rationale)가 빠진 슬롯 판정은 거부한다', () => {
    const output = validOutput();
    delete (output.slots[0] as Record<string, unknown>).rationale;
    expect(() => completenessOutputSchema.parse(output)).toThrow();
  });

  it('루브릭 점수가 0~100 범위 밖이거나 정수가 아니면 거부한다', () => {
    for (const score of [-1, 101, 87.5]) {
      const output = validOutput();
      output.rubric.score = score;
      expect(() => completenessOutputSchema.parse(output)).toThrow();
    }
  });

  it('슬롯 판정이 하나도 없는 출력은 거부한다', () => {
    const output = validOutput();
    output.slots = [];
    expect(() => completenessOutputSchema.parse(output)).toThrow();
  });

  it('계약에 없는 여분 필드는 거부한다', () => {
    const output = { ...validOutput(), overallVerdict: 'refined' };
    expect(() => completenessOutputSchema.parse(output)).toThrow();
  });
});

describe('완결성 룰 층 초안 (결정론적 백스톱)', () => {
  it('「대시보드 만들어줘」— 전 슬롯 미충족이면 즉시 미통과다 (F2c)', () => {
    const result = runRuleLayer({
      requiredSlots: TEMP_REQUIRED_SLOTS,
      slotStates: TEMP_REQUIRED_SLOTS.map((slot) => ({ slotKey: slot.key, state: 'unfilled' })),
    });

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => (f.rule === 'slot' ? f.slotKey : ''))).toEqual([
      'target-user',
      'purpose',
      'data-source',
    ]);
  });

  it('모든 필수 슬롯이 충족 또는 승격이면 통과한다', () => {
    const result = runRuleLayer({
      requiredSlots: TEMP_REQUIRED_SLOTS,
      slotStates: [
        { slotKey: 'target-user', state: 'filled' },
        { slotKey: 'purpose', state: 'filled' },
        { slotKey: 'data-source', state: 'promoted' },
      ],
    });

    expect(result).toEqual({ passed: true, failures: [] });
  });

  it('판정 자체가 없는 필수 슬롯은 미충족으로 취급한다', () => {
    const result = runRuleLayer({
      requiredSlots: TEMP_REQUIRED_SLOTS,
      slotStates: [{ slotKey: 'target-user', state: 'filled' }],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      { rule: 'slot', slotKey: 'purpose' },
      { rule: 'slot', slotKey: 'data-source' },
    ]);
  });

  it('수용기준에 금칙 모호어가 남아 있으면 미통과다', () => {
    const result = runRuleLayer({
      requiredSlots: [],
      slotStates: [],
      acceptanceCriteriaTexts: [
        'When 매니저가 기간을 선택하면, the system shall 적당히 빠르게 결과를 보여준다',
        'When 데이터가 갱신되면, the system shall 조회 화면을 개선한다',
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      {
        rule: 'banned-vague-term',
        term: '적당히',
        text: 'When 매니저가 기간을 선택하면, the system shall 적당히 빠르게 결과를 보여준다',
      },
      {
        rule: 'banned-vague-term',
        term: '개선',
        text: 'When 데이터가 갱신되면, the system shall 조회 화면을 개선한다',
      },
    ]);
  });

  it('검증 가능한 수용기준만 있으면 모호어 검사를 통과한다', () => {
    const result = runRuleLayer({
      requiredSlots: [],
      slotStates: [],
      acceptanceCriteriaTexts: [
        'When 매니저가 기간을 선택하면, the system shall 3초 이내에 월별 매출 합계를 표시한다',
      ],
    });

    expect(result).toEqual({ passed: true, failures: [] });
  });

  it('영어 수용기준의 금칙 모호어도 검출한다 — 대소문자 무관 (F2d 다국어)', () => {
    const text = 'When the manager opens the page, the system shall Improve the view ASAP';
    const result = runRuleLayer({
      requiredSlots: [],
      slotStates: [],
      acceptanceCriteriaTexts: [text],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      { rule: 'banned-vague-term', term: 'asap', text },
      { rule: 'banned-vague-term', term: 'improve', text },
    ]);
  });

  it('영어 모호어는 단어 경계로 매칭한다 — breakfast는 fast에 걸리지 않는다', () => {
    const result = runRuleLayer({
      requiredSlots: [],
      slotStates: [],
      acceptanceCriteriaTexts: [
        'When the user logs breakfast entries, the system shall fetch the daily summary',
      ],
    });

    expect(result).toEqual({ passed: true, failures: [] });
  });
});

describe('2층 완결성 판정 결합', () => {
  /** 룰 층에 걸릴 것 없는 만점 LLM 판정 — 결합 테스트들의 기준값. */
  function perfectLlmOutput() {
    return completenessOutputSchema.parse({
      slots: [{ slotKey: 'target-user', verdict: 'filled', rationale: '명시적 답 있음' }],
      remainingAmbiguities: [],
      rubric: { score: 100, rationale: '모호성 없음' },
    });
  }

  it('룰 미통과면 LLM이 만점을 줘도 미정제다 (F2c — 백스톱)', () => {
    const rule = runRuleLayer({
      requiredSlots: TEMP_REQUIRED_SLOTS,
      slotStates: [{ slotKey: 'target-user', state: 'filled' }], // purpose·data-source 미충족
    });

    const verdict = judgeCompleteness({ rule, llm: perfectLlmOutput() });

    expect(verdict.refined).toBe(false);
    expect(verdict.llmScore).toBe(100);
    expect(verdict.rule.passed).toBe(false);
  });

  it('룰 통과 + 루브릭 점수가 임계치 이상이면 정제다', () => {
    const rule = runRuleLayer({ requiredSlots: [], slotStates: [] });

    const verdict = judgeCompleteness({ rule, llm: perfectLlmOutput() });

    expect(verdict).toMatchObject({ refined: true, llmScore: 100 });
  });

  it('룰을 통과해도 루브릭 점수가 임계치 미만이면 미정제다 (의미 판정)', () => {
    const rule = runRuleLayer({ requiredSlots: [], slotStates: [] });
    const llm = perfectLlmOutput();
    llm.rubric.score = COMPLETENESS_RUBRIC_V0.minScore - 1;

    const verdict = judgeCompleteness({ rule, llm });

    expect(verdict.refined).toBe(false);
  });

  it('임계치 경계값 — minScore와 같으면 정제다', () => {
    const rule = runRuleLayer({ requiredSlots: [], slotStates: [] });
    const llm = perfectLlmOutput();
    llm.rubric.score = COMPLETENESS_RUBRIC_V0.minScore;

    expect(judgeCompleteness({ rule, llm }).refined).toBe(true);
  });

  it('LLM이 미충족으로 판정한 슬롯이 있으면 점수가 만점이어도 미정제다 (모순 출력의 보수 결합)', () => {
    const rule = runRuleLayer({ requiredSlots: [], slotStates: [] }); // 룰 층은 통과
    const llm = completenessOutputSchema.parse({
      slots: [
        { slotKey: 'target-user', verdict: 'filled', rationale: '명시적 답 있음' },
        { slotKey: 'purpose', verdict: 'unfilled', rationale: '어떤 문제를 푸는지 답이 없음' },
      ],
      remainingAmbiguities: [],
      rubric: { score: 100, rationale: '과신 점수 — 슬롯 판정과 모순' },
    });

    const verdict = judgeCompleteness({ rule, llm });

    expect(verdict.refined).toBe(false);
    expect(verdict.llmUnfilledSlotKeys).toEqual(['purpose']);
  });
});
