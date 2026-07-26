import type { SessionStatus } from './types';

// 상태 → 여정 스테퍼·상태 칩 매핑 (G-6·M-1). 서버 status가 유일한 근거다.

export const JOURNEY_STEPS = [
  { index: 1, label: '접수' },
  { index: 2, label: '내용 정리' },
  { index: 3, label: '문서 확정' },
  { index: 4, label: '개발팀 검토', pending: true },
  { index: 5, label: '진행·완료', pending: true },
] as const;

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
  label: string;
  /** action = 요청자 차례(M-1 내 차례 신호), progress = 시스템 처리 중, hold = 보류, done = 완료 */
  tone: 'action' | 'progress' | 'hold' | 'done';
}

export function statusChip(status: SessionStatus, terminalState: string | null): StatusChip {
  switch (status) {
    case 'intake':
      return { label: '질문 준비 중', tone: 'progress' };
    case 'clarifying':
      return { label: '답변해 주세요', tone: 'action' };
    case 'documented':
      return { label: '문서 완성 — 확인해 주세요', tone: 'action' };
    case 'closed':
      return terminalState === 'on_hold_insufficient_info'
        ? { label: '보류 — 언제든 재개', tone: 'hold' }
        : { label: '종결', tone: 'done' };
  }
}

/** 현재 답변 중인 라운드가 마지막인지 — 상한 발동 예고(P-U5). */
export function isLastRound(roundCount: number, roundBudget: number): boolean {
  return roundCount >= roundBudget;
}
