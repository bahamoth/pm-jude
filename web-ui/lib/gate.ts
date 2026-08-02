import type { Key } from './i18n';
import type { GateDecision } from './types';

// 게이트 표시·결정 가드의 순수 로직 (F5 #69) — 화면 분기는 여기서 정하고 컴포넌트는 그린다.

/** 종결 화면의 카드 종류 — terminalState가 유일한 근거다 (F8). */
export type ClosedCardKind = 'issue' | 'backlog' | 'rejected' | 'onHold' | 'generic';

export function closedCardKind(terminalState: string | null): ClosedCardKind {
  switch (terminalState) {
    case 'issue_created':
      return 'issue';
    case 'backlog':
      return 'backlog';
    case 'rejected':
      return 'rejected';
    case 'on_hold_insufficient_info':
      return 'onHold';
    default:
      // 미래의 종결 상태(중복 병합 등)는 generic으로 받는다 — 화면이 깨지지 않게
      return 'generic';
  }
}

/** 거절의 통제된 사유 태그 → 사전 키. 미지의 태그는 null — 화면은 태그 원문으로 폴백한다. */
export function rejectReasonKey(tag: string | null): Key | null {
  switch (tag) {
    case 'priority':
      return 'reason.priority';
    case 'out_of_scope':
      return 'reason.out_of_scope';
    case 'duplicate':
      return 'reason.duplicate';
    case 'technically_infeasible':
      return 'reason.technically_infeasible';
    case 'insufficient_info':
      return 'reason.insufficient_info';
    default:
      return null;
  }
}

/**
 * 결정 커밋 가능 여부 — 서버 계약의 화면판: 질문은 노트가, 거절은 사유가 필수다.
 * 서버도 같은 검증을 하지만(400), 제출 후에 실패를 알게 하지 않는다 (P-U1).
 */
export function decisionReady(
  decision: GateDecision,
  input: { note?: string; reasonTag?: string },
): boolean {
  if (decision === 'question') return Boolean(input.note?.trim());
  if (decision === 'reject') return Boolean(input.reasonTag);
  return true;
}

/** 게이트 검토 대기 중인가 — documented 세션의 「검토 대기」 안내 근거. */
export function gateWaiting(
  status: string,
  gate: { decision: GateDecision | null } | null,
): boolean {
  return status === 'documented' && gate !== null && gate.decision === null;
}
