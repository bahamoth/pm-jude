import { describe, expect, it } from 'vitest';
import { aggregateRetro, renderRetroReport } from '../src/analysis/aggregate';
import { fetchLinearArchive } from '../src/analysis/linear-archive';
import {
  createAnalysisRegistry,
  REQUESTION_CLASSIFICATION_V0,
  requestionClassificationSchema,
} from '../src/analysis/requestion-classification-v0';

/** 스키마를 통과하는 기준 분류 — red 테스트들은 여기서 한 요소씩 무너뜨린다. */
function validClassification() {
  return {
    requestions: [
      {
        commentIndex: 2,
        excerpt: '이거 누가 쓰는 화면인가요? 영업팀만 보면 되나요?',
        type: 'missing-target-user',
        typeDescription: '대상 사용자가 명시되지 않음',
        requesterResolvable: 'resolvable' as const,
        rationale: '요청자가 업무 지식으로 답할 수 있는 질문',
      },
      {
        commentIndex: 5,
        excerpt: '실적 기준 테이블이 CRM인가요 정산 DB인가요?',
        type: 'unclear-data-source',
        typeDescription: '데이터의 진실 원천이 불명',
        requesterResolvable: 'unresolvable' as const,
        rationale: '진실 원천 테이블은 요청자가 원리적으로 답할 수 없음',
      },
    ],
  };
}

describe('재질문 분류 프롬프트 v0 (분석 전용 레지스트리)', () => {
  it('분석 레지스트리에 requestion-classification@0.1.0으로 등록되어 있다', () => {
    const registry = createAnalysisRegistry();
    const version = registry.get(REQUESTION_CLASSIFICATION_V0);

    expect(version.name).toBe('requestion-classification');
    expect(version.regressionPassed).toBe(false);
    expect(version.outputSchema).toBe(requestionClassificationSchema);
  });

  it('기준 분류가 스키마를 통과하고, 재질문 없음(빈 배열)도 유효하다', () => {
    expect(requestionClassificationSchema.parse(validClassification()).requestions).toHaveLength(2);
    expect(requestionClassificationSchema.parse({ requestions: [] }).requestions).toEqual([]);
  });

  it('해소 가능/불가 3분류 밖의 값은 거부한다 (§2.1 전제 검증 입력)', () => {
    const output = validClassification();
    (output.requestions[0] as Record<string, unknown>).requesterResolvable = 'maybe';
    expect(() => requestionClassificationSchema.parse(output)).toThrow();
  });

  it('유형 키·근거 인용이 빠진 재질문은 거부한다', () => {
    for (const field of ['type', 'excerpt', 'rationale']) {
      const output = validClassification();
      delete (output.requestions[0] as Record<string, unknown>)[field];
      expect(() => requestionClassificationSchema.parse(output)).toThrow();
    }
  });
});

describe('소급 분석 집계 (결정론적)', () => {
  const items = [
    {
      issue: { identifier: 'ENG-1', reopenCount: 1, descriptionEditCount: 2 },
      classification: validClassification(),
    },
    {
      issue: { identifier: 'ENG-2', reopenCount: 0, descriptionEditCount: 0 },
      classification: {
        requestions: [
          {
            commentIndex: 0,
            excerpt: '어느 팀 대상인가요?',
            type: 'missing-target-user',
            typeDescription: '대상 사용자 불명',
            requesterResolvable: 'resolvable' as const,
            rationale: '업무 지식 질문',
          },
        ],
      },
    },
    {
      issue: { identifier: 'ENG-3', reopenCount: 0, descriptionEditCount: 1 },
      classification: { requestions: [] },
    },
  ];

  it('베이스라인 수치 — 재질문 빈도가 §10 감소율 지표의 분모로 산출된다', () => {
    const report = aggregateRetro(items);

    expect(report.baseline).toEqual({
      issueCount: 3,
      issuesWithRequestions: 2,
      requestionCount: 3,
      requestionsPerIssue: 1,
      requestionIssueRatio: 2 / 3,
      reopenCount: 1,
      descriptionEditCount: 3,
    });
  });

  it('유형 분류표 — 빈도 내림차순, 해소 가능/불가 구분 포함 (F2e·중단 기준 (c))', () => {
    const report = aggregateRetro(items);

    expect(report.typeTable).toEqual([
      {
        type: 'missing-target-user',
        description: '대상 사용자가 명시되지 않음',
        count: 2,
        resolvable: 2,
        unresolvable: 0,
        unclear: 0,
      },
      {
        type: 'unclear-data-source',
        description: '데이터의 진실 원천이 불명',
        count: 1,
        resolvable: 0,
        unresolvable: 1,
        unclear: 0,
      },
    ]);
  });

  it('리포트 마크다운에 분류표·베이스라인·해소 불가 비율이 담긴다', () => {
    const markdown = renderRetroReport(aggregateRetro(items), {
      teamKey: 'ENG',
      since: '2025-10-26',
      promptRef: REQUESTION_CLASSIFICATION_V0,
      modelVersion: 'claude-sonnet-5',
    });

    expect(markdown).toContain('missing-target-user');
    expect(markdown).toContain('| 2 |');
    expect(markdown).toContain('requestion-classification@0.1.0'); // 버전 귀속 (F11)
    expect(markdown).toContain('33'); // 해소 불가 비율 1/3 → 33.3%
  });
});

describe('Linear 아카이브 추출 (주입 fetch)', () => {
  function pageResponse(nodes: unknown[], hasNextPage: boolean, endCursor: string | null) {
    return {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: { issues: { nodes, pageInfo: { hasNextPage, endCursor } } },
        }),
    } as Response;
  }

  const issueNode = (identifier: string) => ({
    identifier,
    title: `${identifier} 제목`,
    description: '설명',
    createdAt: '2026-01-01T00:00:00.000Z',
    comments: {
      nodes: [
        {
          body: '누가 쓰나요?',
          createdAt: '2026-01-02T00:00:00.000Z',
          user: { displayName: '개발자A' },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    history: {
      nodes: [
        {
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedDescription: true,
          fromState: { type: 'completed' },
          toState: { type: 'started' },
        },
        {
          createdAt: '2026-01-04T00:00:00.000Z',
          updatedDescription: false,
          fromState: { type: 'unstarted' },
          toState: { type: 'started' },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });

  it('페이지네이션을 따라가며 이슈·코멘트·reopen·스펙 편집 수를 뽑는다', async () => {
    const calls: Array<{ body: string; auth: string | undefined }> = [];
    const fetchFn: typeof fetch = (_url, init) => {
      const body = String(init?.body);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ body, auth: headers?.Authorization });
      return Promise.resolve(
        calls.length === 1
          ? pageResponse([issueNode('ENG-1')], true, 'cursor-1')
          : pageResponse([issueNode('ENG-2')], false, null),
      );
    };

    const issues = await fetchLinearArchive({
      apiKey: 'lin_api_test',
      teamKey: 'ENG',
      since: '2025-10-26',
      fetchFn,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.auth).toBe('lin_api_test');
    expect(calls[1]?.body).toContain('cursor-1'); // 두 번째 호출은 커서를 넘긴다
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      identifier: 'ENG-1',
      reopenCount: 1, // completed → started 전이만 reopen
      descriptionEditCount: 1,
      commentsTruncated: false,
    });
    expect(issues[0]?.comments[0]).toMatchObject({ index: 0, author: '개발자A' });
  });

  it('GraphQL 에러 응답이면 이유를 담아 던진다', async () => {
    const fetchFn: typeof fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ errors: [{ message: 'Invalid API key' }] }),
      } as Response);

    await expect(
      fetchLinearArchive({ apiKey: 'bad', teamKey: 'ENG', since: '2025-10-26', fetchFn }),
    ).rejects.toThrow('Invalid API key');
  });
});
