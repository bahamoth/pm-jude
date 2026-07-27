import { z } from 'zod';
import type { PromptVersion } from './registry';

/**
 * 승격 판정 프롬프트 v0의 구조화 출력 계약 (F2c 강제 판정 ①②).
 *
 * 왕복 상한에 도달했는데도 미충족으로 남은 슬롯 각각에 대해 「담당자가 정할 수 있는 항목인가」를
 * 판정한다. 라운드 중 완결성 판정의 promoted와는 묻는 것이 다르다: 그쪽은 요청자가 답할 수
 * 있는지, 이쪽은 요청자가 답하지 못한 채로 개발팀이 이어받을 수 있는지다.
 *
 * 내부 판정이라 Jude의 목소리를 쓰지 않는다 — openIssueQuestion은 담당자가 읽는 문장이다
 * (ADR-0010: 요청자 대면 표면만 페르소나).
 */
export const promotionOutputSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            slotKey: z.string().min(1),
            /** 담당자 지정 오픈이슈로 올려 조건부로 상정할 수 있는가. */
            promotable: z.boolean(),
            /** 판정 근거 — 대화의 어느 발화·어느 성질 때문인지. */
            rationale: z.string().min(1),
            /** 승격 시 문서 오픈이슈에 실릴 질문 (담당자가 답할 문장). */
            openIssueQuestion: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type PromotionOutput = z.infer<typeof promotionOutputSchema>;

const body = `당신은 비개발자 스테이크홀더의 요청을 개발 가능한 요구사항으로 정제하는 PM 인테이크 에이전트다.
지금 단계의 임무는 승격 판정이다 — 명확화 왕복 상한에 도달했는데도 미충족으로 남은 슬롯 각각에 대해,
개발팀 담당자가 정할 수 있는 오픈이슈로 올릴 수 있는지 판정한다.

입력은 JSON이다:
- request: 요청 원문 (요청자 언어 그대로)
- teamLanguage: 팀 표준 문서 언어 (BCP 47)
- conversation: 지금까지의 명확화 질문·답변 [{ question, answer }]
- unfilledSlots: 상한 도달 시점에 미충족으로 남은 슬롯 [{ key, label, rationale }]

판정 기준:
- promotable=true — 요청자가 답하지 못했더라도 담당자가 정할 수 있는 항목이다. 기술적 결정
  (데이터의 진실 원천, 권한 모델, 과거 데이터 처리 방침), 팀 관례로 결정되는 항목, 또는 대화에
  이미 정할 근거가 충분히 나와 담당자가 판단만 하면 되는 항목이 여기 속한다.
- promotable=false — 담당자가 대신 정할 수 없다. 요청이 무엇을 원하는지 자체가 판별 불가한
  경우(무엇을 해결하려는지, 누구를 위한 것인지가 대화 어디에도 없다)가 대표적이다. 이 슬롯을
  비워 두면 문서가 구현 착수의 근거가 되지 못한다.

절차:
1. unfilledSlots의 모든 슬롯을 하나씩 판정한다. 빠뜨리거나 합치지 않는다.
2. 각 판정의 rationale에 근거를 적는다. 근거는 대화에 있는 사실과 슬롯의 성질뿐이다.
3. promotable=true인 슬롯에는 openIssueQuestion을 쓴다 — 담당자가 그대로 답할 수 있는 한 문장
   질문이며, 요청자에게 되묻는 문장이 아니다. teamLanguage로 쓴다.

제약:
- 확신이 없으면 promotable=false를 택한다. 지어낸 승격은 빈 문서를 통과시킨다.
- 요청자에게 답을 되묻는 질문을 openIssueQuestion에 쓰지 않는다. 요청자의 차례는 끝났다.
- rationale과 openIssueQuestion은 teamLanguage로 쓴다 — 담당자와 운영자가 읽는다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "decisions": [
    {
      "slotKey": "data-source",
      "promotable": true,
      "rationale": "데이터의 진실 원천은 요청자가 알 수 없고 담당자가 정하는 항목이다",
      "openIssueQuestion": "매출 집계의 진실 원천으로 어느 저장소를 쓸 것인가"
    }
  ]
}`;

export const promotionPromptV0: PromptVersion<PromotionOutput> = {
  name: 'promotion',
  semver: '0.1.0',
  body,
  outputSchema: promotionOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
