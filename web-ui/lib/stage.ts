import type { Key } from './i18n';
import type { SessionStatus } from './types';

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
