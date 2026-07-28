import type { SlotTriState } from '../src/prompts/completeness-v0';
import type { CompletenessV1Output } from '../src/prompts/completeness-v1';
import type { RequirementsOutput } from '../src/prompts/requirements-v0';
import type { UiClassificationOutput } from '../src/prompts/ui-classification-v0';

/**
 * 완결성 판정 슬롯 픽스처 (completeness@0.2.0) — attachmentRef를 주면 첨부 유래,
 * 없으면 대화 유래다. 출처는 확인 화면의 표시와 F13 판독의 근거가 된다 (ADR-0011 결정 8).
 */
export function slot(
  slotKey: string,
  verdict: SlotTriState,
  rationale: string,
  attachmentRef?: string,
) {
  return {
    slotKey,
    verdict,
    rationale,
    evidence: attachmentRef
      ? { source: 'attachment' as const, attachmentRef }
      : { source: 'conversation' as const },
  };
}

/** 전 슬롯 해소(충족 2 + 승격 1), 임계치 이상 — 정제 완료로 이끄는 판정. 코어·Slack 심 공용. */
export const refinedCompletenessResponse = JSON.stringify({
  slots: [
    slot('target-user', 'filled', '「영업팀 매니저」라고 확답'),
    slot('purpose', 'filled', '수작업 집계 제거라고 답함'),
    slot('data-source', 'promoted', '요청자가 「모르겠어요 — 개발팀이 정해 주세요」를 택함'),
  ],
  remainingAmbiguities: [],
  rubric: { score: 90, rationale: '핵심 슬롯 모두 해소' },
} satisfies CompletenessV1Output);

/**
 * 비 UI 분류 판정 (F4 전제, #54) — 문서 첫 게시 뒤에 1회 호출된다. 목업 단계와 무관한
 * 기존 심 테스트는 이 응답을 문서 응답 뒤에 실어 목업 생략 경로를 탄다.
 */
export const nonUiClassificationResponse = JSON.stringify({
  isUiRequest: false,
  rationale: '리포트성 요청 — 화면 변화가 없다',
} satisfies UiClassificationOutput);

/** requirements 생성 판정 — 정제 완료 후 문서 조립의 입력. 코어·Slack 심 공용. */
export const requirementsResponse = JSON.stringify({
  problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
  users: ['영업팀 매니저'],
  scope: { inScope: ['월별 매출 추이 조회'], outOfScope: [] },
  stories: [
    {
      story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
      acceptanceCriteria: [
        {
          ears: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
          gwt: {
            given: '매출 데이터가 존재할 때',
            when: '기간을 선택하면',
            then: '월별 합계가 표시된다',
          },
        },
      ],
    },
  ],
  dataSources: [],
  openIssues: [],
} satisfies RequirementsOutput);
