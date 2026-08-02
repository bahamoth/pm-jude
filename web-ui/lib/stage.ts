import type { Key } from './i18n';
import type { PendingRound, SlotView, SessionStatus } from './types';

// 상태 → 여정 스테퍼·상태 칩 매핑 (G-6·M-1). 서버 status가 유일한 근거다.

export const JOURNEY_STEPS = [
  { index: 1, labelKey: 'journey.1' },
  { index: 2, labelKey: 'journey.2' },
  { index: 3, labelKey: 'journey.3' },
  { index: 4, labelKey: 'journey.4' },
  { index: 5, labelKey: 'journey.5', pending: true },
] as const satisfies ReadonlyArray<{ index: number; labelKey: Key; pending?: boolean }>;

/**
 * 현재 여정 단계 (1~5). 보류는 ②에, 목업 반복은 ③(문서 확정) 위에서 돈다 (F4 #54).
 * 게이트(#69)부터 종결이 갈린다: 검토 대기는 ④, 게이트 종결(백로그·거절)은 ④에서 멈추고,
 * 이슈 생성은 ⑤에 닿는다. 보류 종결만 ②로 돌아간다 — 정리가 안 끝난 상태니까.
 */
export function journeyStep(
  status: SessionStatus,
  context?: { terminalState?: string | null; gateWaiting?: boolean },
): number {
  switch (status) {
    case 'intake':
      return 1;
    case 'clarifying':
      return 2;
    case 'documented':
      return context?.gateWaiting ? 4 : 3;
    case 'mockup':
      return 3;
    case 'closed':
      switch (context?.terminalState) {
        case 'issue_created':
          return 5;
        case 'backlog':
        case 'rejected':
          return 4;
        default:
          return 2; // 보류(정보 부족) — 내용 정리가 끝나지 않았다
      }
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
    case 'mockup':
      return { labelKey: 'chip.mockup', tone: 'action' };
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
 * 미완 라운드를 재시도 CTA로 드러낼지 (G-10, #28 S-4).
 * 「무엇이 죽었는가」는 서버(코어의 pendingRound)가 판정한다 — 화면은 처리 중이 아닐 때만 드러낸다.
 * 답변은 이미 서버에 저장돼 있으므로 화면이 할 일은 재제출이 아니라 멱등 재시도다.
 */
export function roundFailed(pendingRound: PendingRound, processing: boolean): boolean {
  return !processing && pendingRound !== null;
}

/**
 * 목업 카드를 어느 모습으로 낼지 (#54 · #66 · #67).
 *
 * 세션 상태가 아니라 **판이 열렸는지**가 기준이다. 승인·에스컬레이션으로 닫힌 판은 열람 +
 * 고치기 진입점(archive)이고, 열린 판은 반복 패널(panel)이다. 재개 구간은 세션을 `mockup`으로
 * 되돌리지 않고 `documented`에서 진행되므로 — 승인이 여정을 되돌리면 완주가 취소된 것처럼
 * 읽힌다 — 같은 상태에서 두 모습이 다 나온다.
 */
export function mockupCardMode(
  mockup: { convergence: string } | null,
): 'panel' | 'archive' | 'none' {
  if (mockup === null) return 'none';
  return mockup.convergence === 'iterating' ? 'panel' : 'archive';
}

/**
 * 다이어그램 확인 가능 상태 (#70) — 슬롯 확인과 같은 창이다: documented·mockup에서만.
 * 백엔드 가드와 일치해야 한다 — 화면이 열어 둔 버튼이 409로 끝나면 안 된다 (P-U1).
 */
export function canConfirmDiagram(status: SessionStatus): boolean {
  return status === 'documented' || status === 'mockup';
}

/** 전면 승격 문서 (#28 S-5) — 채워진 슬롯 없이 전부 개발팀 확인으로 넘어간 경우. */
export function fullyPromoted(slots: readonly SlotView[]): boolean {
  return (
    slots.some((slot) => slot.state === 'promoted') &&
    !slots.some((slot) => slot.state === 'filled')
  );
}
