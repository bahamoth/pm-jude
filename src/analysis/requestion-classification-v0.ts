import { z } from 'zod';
import { PromptRegistry, type PromptVersion } from '../prompts/registry';

/**
 * 재질문 유형 분류 프롬프트 v0 (#9, ADR-0004) — 소급 아카이브 분석의 LLM 보조 단계.
 * 런타임 세션 프롬프트가 아니라 오프라인 분석 프롬프트라 기본 카탈로그가 아닌
 * 분석 전용 레지스트리에 등록한다. 분류 결과는 운영자 검수를 거친다.
 */
export const requestionClassificationSchema = z
  .object({
    /** 이슈에서 발견한 재질문들 — 없으면 빈 배열. */
    requestions: z
      .array(
        z
          .object({
            commentIndex: z.number().int().min(0),
            /** 근거가 된 코멘트 문장 그대로 인용. */
            excerpt: z.string().min(1),
            /** kebab-case 유형 키 — 같은 결핍이면 같은 키를 재사용 (분류표의 행이 된다). */
            type: z.string().min(1),
            typeDescription: z.string().min(1),
            /** 요청자 해소 가능/불가 구분 — §2.1 전제 검증(중단 기준 (c))의 입력. */
            requesterResolvable: z.enum(['resolvable', 'unresolvable', 'unclear']),
            rationale: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type RequestionClassification = z.infer<typeof requestionClassificationSchema>;

const body = `당신은 개발팀의 이슈 트래커 아카이브를 분석하는 리서처다.
임무는 이슈 코멘트에서 「재질문」 — 요구사항 불충분으로 개발자가 요청자에게 다시 물은
명확화성 질문 — 을 찾아 유형 분류하는 것이다.

입력은 JSON이다:
- issue: { identifier, title, description, comments: [{ index, author, body }] }

절차:
1. 각 코멘트에서 요구사항 공백을 메우려는 질문을 찾는다. 진행 보고, 코드 리뷰 지적,
   구현 방식 토론, 잡담은 재질문이 아니다.
2. 재질문마다 어떤 요구 정보가 비어 있었는지를 kebab-case 유형 키로 붙인다
   (예: missing-target-user, unclear-data-source, missing-acceptance-criteria).
   같은 결핍이면 반드시 같은 키를 재사용한다 — 키가 분류표의 행이 된다.
3. requesterResolvable을 판정한다:
   - resolvable — 요청자가 업무 지식으로 답할 수 있었던 질문
   - unresolvable — 요청자가 원리적으로 답할 수 없는 질문
     (데이터의 진실 원천 테이블, 권한 모델, 과거 데이터 처리 방침 등)
   - unclear — 판정 근거 부족
4. excerpt에는 근거 문장을 코멘트에서 그대로 인용한다. 지어내지 않는다.

재질문이 없으면 빈 배열을 낸다. 없는 것을 만들어내는 것이 가장 나쁜 오류다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "requestions": [
    {
      "commentIndex": 2,
      "excerpt": "코멘트에서 그대로 인용한 문장",
      "type": "missing-target-user",
      "typeDescription": "대상 사용자가 명시되지 않음",
      "requesterResolvable": "resolvable",
      "rationale": "판정 근거"
    }
  ]
}`;

export const requestionClassificationPromptV0: PromptVersion<RequestionClassification> = {
  name: 'requestion-classification',
  semver: '0.1.0',
  body,
  outputSchema: requestionClassificationSchema,
  regressionPassed: false, // F12 — 분석 프롬프트도 골든셋 회귀 대상
};

export const REQUESTION_CLASSIFICATION_V0 = 'requestion-classification@0.1.0';

/** 오프라인 분석 프롬프트 전용 레지스트리 — 런타임 카탈로그(catalog.ts)와 분리한다. */
export function createAnalysisRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(requestionClassificationPromptV0);
  return registry;
}
