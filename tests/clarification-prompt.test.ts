import { describe, expect, it } from 'vitest';
import { CLARIFICATION_V0, CLARIFICATION_V1, createDefaultRegistry } from '../src/prompts/catalog';
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

describe('명확화 프롬프트 v1 — Jude의 목소리 (ADR-0010)', () => {
  const registry = createDefaultRegistry();

  it('현행 버전은 clarification@0.2.0이고 v0도 등록된 채로 남는다', () => {
    // 버전은 불변이고 과거 세션의 신호가 v0에 귀속돼 있다
    expect(registry.get(CLARIFICATION_V1).semver).toBe('0.2.0');
    expect(registry.get(CLARIFICATION_V0).semver).toBe('0.1.0');
  });

  it('출력 계약은 v0과 같다 — 바뀐 것은 화자뿐이다', () => {
    expect(registry.get(CLARIFICATION_V1).outputSchema).toBe(
      registry.get(CLARIFICATION_V0).outputSchema,
    );
  });

  it('목소리 규칙을 본문에 싣는다', () => {
    const body = registry.get(CLARIFICATION_V1).body;
    expect(body).toContain('당신은 Jude다');
    expect(body).toContain('1인칭');
    // 「모르겠다」를 회피가 아니라 Jude가 짊어지는 약속으로 쓰게 한다
    expect(body).toContain('제가 개발팀 몫으로 남겨둘게요');
    // 페르소나가 금지하는 것들
    expect(body).toContain('사과하지도 않는다');
    expect(body).toContain('이모지를 쓰지 않는다');
    // 명료함이 목소리보다 우선한다는 제약
    expect(body).toContain('목소리가 질문의 명료함을 이기지 않는다');
  });

  it('요청자 언어가 한국어가 아닐 때의 지침도 있다', () => {
    expect(registry.get(CLARIFICATION_V1).body).toContain("I'll flag it for the team");
  });

  it('회귀 통과 전까지 배포 게이트 플래그는 false다', () => {
    expect(registry.get(CLARIFICATION_V1).regressionPassed).toBe(false);
  });
});

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
