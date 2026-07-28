import type { SlotTriState } from '../src/prompts/completeness-v0';

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
