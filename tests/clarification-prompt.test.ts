import { describe, expect, it } from 'vitest';
import { CLARIFICATION_V0, createDefaultRegistry } from '../src/prompts/catalog';
import { clarificationOutputSchema } from '../src/prompts/clarification-v0';

/** 스키마를 통과하는 기준 출력 — red 테스트들은 여기서 한 요소씩 무너뜨린다. */
function validOutput() {
  return {
    interpretations: [
      '영업 실적을 한눈에 보는 관리자용 대시보드',
      '개인 실적을 확인하는 영업사원용 대시보드',
    ],
    questions: [
      {
        question: '이 대시보드는 주로 누가 보게 되나요?',
        target: { type: 'slot', slotKey: 'target-user' },
        exampleOptions: ['영업팀 매니저', '영업사원 본인', '경영진'],
        dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
      },
      {
        question: '어떤 질문에 답할 수 있어야 하나요?',
        target: { type: 'ambiguity', description: '「실적을 본다」의 구체적 의미가 갈라짐' },
        exampleOptions: ['월별 매출 추이', '담당자별 계약 건수'],
        dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
      },
      {
        question: '데이터는 어디에서 가져오면 되나요?',
        target: { type: 'slot', slotKey: 'data-source' },
        exampleOptions: ['CRM(예: Salesforce)', '사내 DB', '스프레드시트'],
        dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
      },
    ],
  };
}

describe('명확화 프롬프트 v0', () => {
  it('기본 카탈로그에 clarification@0.1.0으로 등록되어 있다', () => {
    const registry = createDefaultRegistry();
    const version = registry.get(CLARIFICATION_V0);

    expect(version.name).toBe('clarification');
    expect(version.body).toContain('모르겠다');
    expect(version.regressionPassed).toBe(false); // F12 — 회귀 통과 전
    expect(version.outputSchema).toBe(clarificationOutputSchema);
  });

  it('기준 출력이 스키마를 통과한다', () => {
    const parsed = clarificationOutputSchema.parse(validOutput());
    expect(parsed.questions).toHaveLength(3);
  });

  it('질문이 3개 미만이거나 5개 초과면 거부한다', () => {
    const two = validOutput();
    two.questions = two.questions.slice(0, 2);
    expect(() => clarificationOutputSchema.parse(two)).toThrow();

    const six = validOutput();
    six.questions = [...six.questions, ...six.questions];
    expect(() => clarificationOutputSchema.parse(six)).toThrow();
  });

  it('「모르겠다 / 개발팀이 정할 문제」 경로가 빠진 질문은 거부한다 (US-10)', () => {
    const output = validOutput();
    delete (output.questions[0] as Record<string, unknown>).dontKnowPath;
    expect(() => clarificationOutputSchema.parse(output)).toThrow();
  });

  it('슬롯·모호성 어느 쪽에도 매핑되지 않은 질문은 거부한다 (F2 수용기준)', () => {
    const output = validOutput();
    (output.questions[0] as Record<string, unknown>).target = { type: 'slot' }; // slotKey 없음
    expect(() => clarificationOutputSchema.parse(output)).toThrow();

    const output2 = validOutput();
    delete (output2.questions[0] as Record<string, unknown>).target;
    expect(() => clarificationOutputSchema.parse(output2)).toThrow();
  });

  it('예시 선택지가 2개 미만인 질문은 거부한다', () => {
    const output = validOutput();
    output.questions[0]!.exampleOptions = ['영업팀 매니저'];
    expect(() => clarificationOutputSchema.parse(output)).toThrow();
  });
});
