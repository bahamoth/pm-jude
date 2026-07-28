import { z } from 'zod';
import type { PromptVersion } from './registry';

/**
 * UI 분류 프롬프트 v0의 구조화 출력 계약 (F4 전제 조건, #54).
 *
 * 문서가 처음 게시되는 시점에 1회 호출된다 — 「이 요청이 UI 변화를 수반하는가」.
 * true면 목업 반복 단계가 열리고, false면 목업을 생략하고 슬롯 단위 확인으로 끝난다.
 * 내부 판정이라 Jude의 목소리를 쓰지 않는다 (ADR-0010).
 */
export const uiClassificationOutputSchema = z
  .object({
    /** 이 요청의 구현이 사용자가 보는 화면의 신설·변경을 수반하는가. */
    isUiRequest: z.boolean(),
    /** 판정 근거 — 요청·문서의 어느 대목 때문인지. */
    rationale: z.string().min(1),
  })
  .strict();

export type UiClassificationOutput = z.infer<typeof uiClassificationOutputSchema>;

const body = `당신은 비개발자 스테이크홀더의 요청을 개발 가능한 요구사항으로 정제하는 PM 인테이크 에이전트다.
지금 단계의 임무는 UI 분류다 — 완성된 requirements 문서를 근거로, 이 요청의 구현이 사용자가 보는
화면의 신설이나 변경을 수반하는지 판정한다. 판정이 참이면 요청자에게 확인용 목업이 만들어진다.

입력은 JSON이다:
- request: 요청 원문 (요청자 언어 그대로)
- document: requirements 문서 구조체 (문제/사용자/스코프/유저스토리/데이터 소스/오픈이슈)
- teamLanguage: 팀 표준 문서 언어 (BCP 47)

판정 기준:
- isUiRequest=true — 화면·페이지·대시보드·폼·버튼·목록 등 사용자가 직접 보고 조작하는
  인터페이스가 새로 생기거나 눈에 띄게 달라진다. 기존 화면에 요소가 추가되는 것도 포함한다.
- isUiRequest=false — 데이터 정정, 리포트/배치 산출물, 성능 개선, 인프라, 권한 변경처럼
  구현돼도 사용자가 보는 화면이 달라지지 않는다. 이메일·파일로 받는 산출물도 여기 속한다.

제약:
- 확신이 없으면 isUiRequest=false를 택한다. 불필요한 목업은 요청자의 왕복을 늘린다.
- rationale은 teamLanguage로 쓴다 — 운영자와 판독 큐가 읽는다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "isUiRequest": true,
  "rationale": "월별 매출 추이를 조회하는 대시보드 화면이 신설된다"
}`;

export const uiClassificationPromptV0: PromptVersion<UiClassificationOutput> = {
  name: 'ui-classification',
  semver: '0.1.0',
  body,
  outputSchema: uiClassificationOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
