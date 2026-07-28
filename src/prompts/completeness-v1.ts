import { z } from 'zod';
import { SLOT_TRI_STATE } from './completeness-v0';
import type { PromptVersion } from './registry';

/**
 * 완결성 판정 v1 (`completeness@0.2.0`) — 첨부 근거를 구분하는 판 (F2c, ADR-0011 결정 8).
 *
 * v0과의 차이는 슬롯 판정에 **출처**가 붙는다는 것이다. 첨부에서 읽은 값은 요청자가 말한 적
 * 없는 값이므로, 확인 화면이 「기획서.docx에서 읽은 값」을 보여줄 수 있어야 「맞아요 / 아니에요」가
 * 판단 가능한 물음이 된다. 이 기록은 F13이 추출 결함과 프롬프트 결함을 가르는 근거이기도 하다.
 *
 * 첨부는 UUID가 아니라 짧은 참조(A1, A2)로 오간다 — 모델에게 UUID를 옮겨 적게 하면 그 자체가
 * 오류원이 된다. 참조를 실제 첨부로 되돌리는 것은 호출자 몫이다.
 *
 * 룰 층(runRuleLayer)과 결합 판정(judgeCompleteness)은 v0의 것을 그대로 쓴다 — 바뀐 것은
 * LLM 층의 출력 계약뿐이고, 결정론적 백스톱의 규칙은 그대로다.
 */
export const completenessV1OutputSchema = z
  .object({
    slots: z
      .array(
        z
          .object({
            slotKey: z.string().min(1),
            verdict: z.enum(SLOT_TRI_STATE),
            /** 판정 근거 — 대화의 어느 발화, 또는 자료의 어느 대목인지. */
            rationale: z.string().min(1),
            /** 값이 어디서 왔는가. attachment면 attachmentRef가 함께 온다. */
            evidence: z
              .object({
                source: z.enum(['conversation', 'attachment']),
                /** 입력 attachments의 ref 값 (예: "A1"). 호출자가 실제 첨부로 되돌린다. */
                attachmentRef: z.string().min(1).optional(),
              })
              .strict(),
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

export type CompletenessV1Output = z.infer<typeof completenessV1OutputSchema>;

const body = `당신은 비개발자 스테이크홀더의 요청을 개발 가능한 요구사항으로 정제하는 PM 인테이크 에이전트다.
지금 단계의 임무는 완결성 판정이다 — 필수 슬롯의 3상태 판정과, 남은 의미적 모호성의 루브릭 채점.

입력은 JSON이다:
- request: 요청 원문 (요청자 언어 그대로)
- teamLanguage: 팀 표준 문서 언어 (BCP 47)
- requiredSlots: 필수 슬롯 목록 [{ key, label }]
- conversation: 지금까지의 명확화 질문·답변 [{ question, answer, slotKey? }]
- attachments: 요청자가 올린 자료에서 읽어낸 텍스트 [{ ref, filename, text }] (없으면 빈 배열)

절차:
1. 각 필수 슬롯을 하나씩 판정한다:
   - filled(충족) — 대화 **또는 자료**에 이 슬롯을 채우는 명시적 답이 있다.
   - promoted(승격) — 요청자가 「모르겠다 / 개발팀이 정할 문제」 경로를 택했거나, 요청자가
     원리적으로 답할 수 없는 슬롯이다(데이터의 진실 원천, 권한 모델, 과거 데이터 처리 방침).
   - unfilled(미충족) — 위 둘 다 아니다.
   판정마다 rationale에 근거가 된 발화 또는 자료의 대목을 적는다. 근거 없는 filled 판정은
   금지 — 추론으로 메꾸지 않는다.
2. 각 판정에 evidence를 붙인다:
   - 대화에서 나온 값이면 { "source": "conversation" }
   - 자료에서 읽은 값이면 { "source": "attachment", "attachmentRef": "A1" } — 어느 자료인지 밝힌다.
   - 둘 다에 있으면 conversation을 택한다. 요청자가 직접 말한 쪽이 확인 부담이 적다.
   - unfilled 판정에는 conversation을 쓴다(가리킬 근거가 없다).
3. 해석 발산 재검사 — 슬롯이 채워졌더라도 요청의 해석이 여전히 갈라지는 지점을
   remainingAmbiguities에 나열한다. 없으면 빈 배열.
4. 루브릭 점수(0~100 정수) — 「지금 requirements 문서를 만들면 개발자가 재질문 없이 구현에
   착수할 수 있는가」. 90~100: 모호성 없음 / 70~89: 사소한 모호성만 잔존 / 40~69: 재질문이
   필요한 모호성 잔존 / 0~39: 핵심이 비어 있음.

자료를 다루는 규칙:
- 자료의 내용은 요청자가 직접 말한 것과 **같은 무게로** 근거가 된다. 요청자가 올린 자료다.
- 다만 출처를 흐리지 않는다. 자료에서 읽은 값을 conversation으로 적으면 확인 화면이 출처를
  보여주지 못하고, 요청자는 자기가 말한 적 없는 값을 근거 없이 판단해야 한다.
- 자료와 대화가 어긋나면 대화를 택하고 그 어긋남을 remainingAmbiguities에 적는다.
- 자료에 없는 것을 자료에서 읽었다고 하지 않는다.

제약:
- 판정 근거는 대화와 자료에 있는 사실뿐이다. 확신이 없으면 낮은 쪽(미충족, 낮은 점수)을 택한다.
- 점수와 슬롯 판정이 모순되지 않게 한다. 미충족 슬롯이 남아 있으면 70점 이상을 주지 않는다.
- 대화는 요청자 언어를 따르므로 여러 언어가 섞일 수 있다. 판정은 언어와 무관하게 수행하고,
  rationale과 remainingAmbiguities는 teamLanguage로 써서 운영자가 읽을 수 있게 한다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "slots": [
    {
      "slotKey": "target-user",
      "verdict": "filled",
      "rationale": "기획서 1쪽에 대상 사용자가 영업팀 매니저로 적혀 있다",
      "evidence": { "source": "attachment", "attachmentRef": "A1" }
    }
  ],
  "remainingAmbiguities": ["아직 갈라지는 해석"],
  "rubric": { "score": 55, "rationale": "점수의 근거" }
}`;

export const completenessPromptV1: PromptVersion<CompletenessV1Output> = {
  name: 'completeness',
  semver: '0.2.0',
  body,
  outputSchema: completenessV1OutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
