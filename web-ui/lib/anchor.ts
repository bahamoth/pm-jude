/**
 * 선택 지점 옆 팝오버 좌표 (#66 UX) — 정정은 고칠 곳 **바로 옆**에서 시작해야 한다.
 *
 * 카드 하단의 고정 패널은 선택한 곳과 입력하는 곳이 멀어 무엇을 고치는 중인지 눈으로
 * 붙잡을 수 없었다. 사각형 계산만 떼어내 DOM 없이 검증한다.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface AnchorResult {
  /** 컨테이너 기준 좌표 (컨테이너는 position: relative). */
  top: number;
  left: number;
  placement: 'below' | 'above';
}

const GAP = 8;

export function anchorPosition(
  target: Rect,
  container: Rect,
  popover: { width: number; height: number },
  viewportHeight: number,
): AnchorResult {
  // 선택한 줄의 왼쪽에 맞추되 컨테이너 밖으로 나가지 않게 당긴다 — 잘린 팝오버는 못 쓴다
  const rawLeft = target.left - container.left;
  const maxLeft = container.width - popover.width;
  const left = Math.max(0, Math.min(rawLeft, Math.max(0, maxLeft)));

  const belowTop = target.top - container.top + target.height + GAP;
  const spaceBelow = viewportHeight - (target.top + target.height);
  const spaceAbove = target.top;
  // 아래가 좁고 위가 넉넉하면 위로 — 위도 좁으면 아래로 되돌린다(위쪽 잘림이 더 나쁘다)
  if (spaceBelow < popover.height + GAP && spaceAbove > popover.height + GAP) {
    return {
      top: target.top - container.top - popover.height - GAP,
      left,
      placement: 'above',
    };
  }
  return { top: belowTop, left, placement: 'below' };
}
