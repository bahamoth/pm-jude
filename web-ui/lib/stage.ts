import type { Key } from './i18n';
import type { SessionStatus, SlotView, Utterance } from './types';

// 상태 → 여정 스테퍼·상태 칩 매핑 (G-6·M-1). 서버 status가 유일한 근거다.

export const JOURNEY_STEPS = [
  { index: 1, labelKey: 'journey.1' },
  { index: 2, labelKey: 'journey.2' },
  { index: 3, labelKey: 'journey.3' },
  { index: 4, labelKey: 'journey.4', pending: true },
  { index: 5, labelKey: 'journey.5', pending: true },
] as const satisfies ReadonlyArray<{ index: number; labelKey: Key; pending?: boolean }>;

/** 현재 여정 단계 (1~5). 보류는 ②에 머무는 상태로 취급한다. */
export function journeyStep(status: SessionStatus): number {
  switch (status) {
    case 'intake':
      return 1;
    case 'clarifying':
      return 2;
    case 'documented':
      return 3;
    case 'closed':
      return 2;
  }
}

export interface StatusChip {
  labelKey: Key;
  /** action = 요청자 차례(M-1 내 차례 신호), progress = 시스템 처리 중, hold = 보류, done = 완료 */
  tone: 'action' | 'progress' | 'hold' | 'done';
}

export function statusChip(status: SessionStatus, terminalState: string | null): StatusChip {
  switch (status) {
    case 'intake':
      return { labelKey: 'chip.intake', tone: 'progress' };
    case 'clarifying':
      return { labelKey: 'chip.clarifying', tone: 'action' };
    case 'documented':
      return { labelKey: 'chip.documented', tone: 'action' };
    case 'closed':
      return terminalState === 'on_hold_insufficient_info'
        ? { labelKey: 'chip.onHold', tone: 'hold' }
        : { labelKey: 'chip.closed', tone: 'done' };
  }
}

/** 현재 답변 중인 라운드가 마지막인지 — 상한 발동 예고(P-U5). */
export function isLastRound(roundCount: number, roundBudget: number): boolean {
  return roundCount >= roundBudget;
}

/**
 * 미완 라운드 판정 (G-10, #28 S-4) — 처리 중이 아닌데 마지막 발화가 요청자면 라운드가 죽은 것이다.
 * 답변은 이미 서버에 저장돼 있으므로 화면이 할 일은 재제출이 아니라 멱등 재시도 CTA다.
 * 종결 세션은 대상이 아니다 — 보류 재개는 입력이 하는 일이다(#30).
 */
export function roundFailed(
  status: SessionStatus,
  utterances: readonly Utterance[],
  processing: boolean,
): boolean {
  if (processing || status === 'closed') return false;
  if (status === 'intake') return true; // 질문이 아직 없다 = 첫 라운드가 죽었다
  return utterances.at(-1)?.authorType === 'requester';
}

/**
 * Phase 0 종착 (G-11, #28 S-6) — 요청자가 확인할 수 있는 슬롯(충족)이 모두 확인된 상태.
 * 승격 슬롯은 담당자 몫이라 분모에 넣지 않는다.
 */
export function allSlotsConfirmed(slots: readonly SlotView[]): boolean {
  const confirmable = slots.filter((slot) => slot.state === 'filled');
  return confirmable.length > 0 && confirmable.every((slot) => slot.confirmedByRequester);
}

/** 전면 승격 문서 (#28 S-5) — 채워진 슬롯 없이 전부 개발팀 확인으로 넘어간 경우. */
export function fullyPromoted(slots: readonly SlotView[]): boolean {
  return (
    slots.some((slot) => slot.state === 'promoted') &&
    !slots.some((slot) => slot.state === 'filled')
  );
}
