export type SlotAction = 'confirm-or-correct' | 'correct-only' | 'none';

/**
 * 슬롯 확인 카드가 슬롯마다 내밀 행동 (#51).
 * 확인된 슬롯에서도 정정 진입점은 닫지 않는다 — 코어는 documented 세션이면 완주
 * 뒤에도 정정 재생성을 허용하므로(confirmSlot), 화면이 그 경로를 막으면 문서를
 * 고칠 방법이 API 직접 호출뿐이게 된다. 확인을 되돌리는 건 정정 제출이 하는 일이다.
 */
export function slotActionOf(slot: {
  state: string;
  confirmedByRequester: boolean;
}): SlotAction {
  if (slot.state !== 'filled') return 'none';
  return slot.confirmedByRequester ? 'correct-only' : 'confirm-or-correct';
}
