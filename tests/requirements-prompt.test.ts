import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, REQUIREMENTS_V0 } from '../src/prompts/catalog';
import {
  assembleRequirementsDocument,
  requirementsOutputSchema,
} from '../src/prompts/requirements-v0';

/** 스키마를 통과하는 기준 출력 — red 테스트들은 여기서 한 요소씩 무너뜨린다. */
function validOutput() {
  return {
    problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 매주 수작업으로 집계한다',
    users: ['영업팀 매니저'],
    scope: {
      inScope: ['월별 매출 추이 조회', '담당자별 계약 건수 조회'],
      outOfScope: ['실적 예측'],
    },
    stories: [
      {
        story: '영업팀 매니저로서, 월별 매출 추이를 확인해 팀 목표 달성 여부를 판단하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 매니저가 기간을 선택하면, the system shall 해당 기간의 월별 매출 합계를 표시한다',
            gwt: {
              given: '2026년 1~6월 매출 데이터가 존재할 때',
              when: '매니저가 기간을 1~6월로 선택하면',
              then: '월별 매출 합계 6개가 표시된다',
            },
          },
        ],
      },
    ],
    dataSources: ['CRM 계약 테이블'],
    openIssues: [],
  };
}

describe('requirements 프롬프트 v0', () => {
  it('기본 카탈로그에 requirements@0.1.0으로 등록되어 있다', () => {
    const registry = createDefaultRegistry();
    const version = registry.get(REQUIREMENTS_V0);

    expect(version.name).toBe('requirements');
    expect(version.body.length).toBeGreaterThan(0);
    expect(version.regressionPassed).toBe(false);
    expect(version.outputSchema).toBe(requirementsOutputSchema);
  });

  it('기준 출력이 스키마를 통과한다', () => {
    const parsed = requirementsOutputSchema.parse(validOutput());
    expect(parsed.stories).toHaveLength(1);
  });

  it('아키텍처·스택 등 「어떻게」 필드는 거부한다 (원칙 3)', () => {
    for (const forbidden of ['architecture', 'techStack', 'implementation']) {
      const output = { ...validOutput(), [forbidden]: '마이크로서비스로 구성' };
      expect(() => requirementsOutputSchema.parse(output)).toThrow();
    }
  });

  it('수용기준에 EARS 구문이나 Given-When-Then이 빠진 스토리는 거부한다 (F3)', () => {
    const noGwt = validOutput();
    delete (noGwt.stories[0]!.acceptanceCriteria[0] as Record<string, unknown>).gwt;
    expect(() => requirementsOutputSchema.parse(noGwt)).toThrow();

    const noEars = validOutput();
    delete (noEars.stories[0]!.acceptanceCriteria[0] as Record<string, unknown>).ears;
    expect(() => requirementsOutputSchema.parse(noEars)).toThrow();

    const noCriteria = validOutput();
    noCriteria.stories[0]!.acceptanceCriteria = [];
    expect(() => requirementsOutputSchema.parse(noCriteria)).toThrow();
  });
});

describe('requirements 문서 조립 (코드 강제 구간)', () => {
  const promotedSlots = [
    {
      slotKey: 'data-source',
      openIssueAssignee: 'dev-lead',
      question: '실적의 진실 원천 테이블은 무엇인가?',
    },
  ];
  const utterances = [
    {
      seq: 1,
      authorType: 'requester' as const,
      originalText: '영업 실적 대시보드 하나 만들어 주세요',
      originalLanguage: 'ko',
    },
  ];

  it('승격 슬롯은 LLM 출력과 무관하게 오픈이슈 필드에 들어간다 (F2c)', () => {
    const doc = assembleRequirementsDocument({
      output: requirementsOutputSchema.parse(validOutput()),
      promotedSlots,
      utterances,
    });

    expect(doc.content.openIssues).toEqual([
      {
        slotKey: 'data-source',
        question: '실적의 진실 원천 테이블은 무엇인가?',
        assignee: 'dev-lead',
      },
    ]);
  });

  it('LLM이 이미 제안한 오픈이슈는 중복 추가하지 않는다', () => {
    const output = requirementsOutputSchema.parse({
      ...validOutput(),
      openIssues: [
        { slotKey: 'data-source', question: 'LLM이 쓴 질문', assignee: null },
        { slotKey: 'permission-model', question: '권한 모델은 기존을 따르는가?', assignee: null },
      ],
    });

    const doc = assembleRequirementsDocument({ output, promotedSlots, utterances });

    expect(doc.content.openIssues).toHaveLength(2);
    // 승격 슬롯의 담당자가 코드에서 확정된다
    expect(doc.content.openIssues.find((i) => i.slotKey === 'data-source')).toMatchObject({
      assignee: 'dev-lead',
    });
  });

  it('원문 전사가 문서에 그대로 첨부된다 (원칙 7)', () => {
    const doc = assembleRequirementsDocument({
      output: requirementsOutputSchema.parse(validOutput()),
      promotedSlots: [],
      utterances,
    });

    expect(doc.originalTranscript).toEqual(utterances);
  });
});
