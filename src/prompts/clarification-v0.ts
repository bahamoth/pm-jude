import { z } from 'zod';
import type { PromptVersion } from './registry';

/**
 * 명확화 프롬프트 v0의 구조화 출력 계약 (F2b).
 * 「각 질문이 특정 모호성·공백 슬롯에 매핑」과 「모르겠다 경로 상시 포함」(US-10)을
 * 프롬프트 지시가 아니라 스키마로 강제한다 — 게이트웨이가 검증·재시도한다.
 */
export const clarificationOutputSchema = z
  .object({
    /** 동일 요청의 그럴듯한 해석 후보 다중 전개 (ClarifyGPT식). */
    interpretations: z.array(z.string().min(1)).min(1),
    questions: z
      .array(
        z
          .object({
            /** 요청자 언어·비즈니스 어휘로 쓴 표적 질문. */
            question: z.string().min(1),
            /** 이 질문이 겨냥하는 공백 슬롯 또는 해석이 갈라지는 지점. */
            target: z.discriminatedUnion('type', [
              z.object({ type: z.literal('slot'), slotKey: z.string().min(1) }).strict(),
              z.object({ type: z.literal('ambiguity'), description: z.string().min(1) }).strict(),
            ]),
            exampleOptions: z.array(z.string().min(1)).min(2),
            /** 「모르겠다 / 개발팀이 정할 문제」 상시 경로 — 승격(F2c) 트리거 입력. */
            dontKnowPath: z.object({ label: z.string().min(1) }).strict(),
          })
          .strict(),
      )
      .min(3)
      .max(5),
  })
  .strict();

export type ClarificationOutput = z.infer<typeof clarificationOutputSchema>;

const body = `당신은 비개발자 스테이크홀더의 요청을 개발 가능한 요구사항으로 정제하는 PM 인테이크 에이전트다.
지금 단계의 임무는 단 하나 — 요청의 모호성을 드러내는 표적 질문 3~5개를 만드는 것이다.

입력은 JSON이다:
- request: 요청 원문 (요청자 언어 그대로)
- requesterLanguage: 요청자의 언어 (BCP 47)
- requiredSlots: 필수 슬롯 목록 [{ key, label, state }] — state가 "unfilled"인 슬롯이 공백이다
- contextNotes: 컨텍스트 그라운딩 결과 요약 (있을 수도, 없을 수도 있다)

절차:
1. 요청의 그럴듯한 해석 후보를 2개 이상 전개한다. 해석이 하나뿐이라고 확신되면 하나만 적는다.
2. 해석이 서로 갈라지는 지점(누가 쓰나, 어떤 질문에 답하나, 데이터는 어디서, 얼마나 자주)과
   공백 슬롯을 겨냥하는 표적 질문을 만든다. 이미 답이 있는 것은 묻지 않는다.
3. 질문은 반드시 requesterLanguage로, 기술 용어 없이 요청자의 비즈니스 어휘로 쓴다.
4. 각 질문에 예시 선택지를 2개 이상 제공한다. 선택지도 비즈니스 어휘로 쓴다.
5. 각 질문에 「모르겠다 / 개발팀이 정할 문제다」 경로를 반드시 포함한다. 요청자가 원리적으로
   답할 수 없는 항목(데이터의 진실 원천, 권한 모델, 과거 데이터 처리)일수록 이 경로가 중요하다.

제약:
- 질문은 한 번에 3~5개. 그 이상 만들지 않는다.
- 각 질문은 특정 슬롯(target.type="slot") 또는 특정 모호성(target.type="ambiguity") 하나에 매핑한다.
- 해결책·아키텍처·기술 스택을 제안하지 않는다. 요구를 정제할 뿐 결정하지 않는다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "interpretations": ["해석 후보 1", "해석 후보 2"],
  "questions": [
    {
      "question": "요청자 언어로 쓴 질문",
      "target": { "type": "slot", "slotKey": "target-user" } 또는 { "type": "ambiguity", "description": "갈라지는 지점" },
      "exampleOptions": ["선택지 1", "선택지 2"],
      "dontKnowPath": { "label": "모르겠어요 — 개발팀이 정해 주세요" }
    }
  ]
}`;

export const clarificationPromptV0: PromptVersion<ClarificationOutput> = {
  name: 'clarification',
  semver: '0.1.0',
  body,
  outputSchema: clarificationOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
