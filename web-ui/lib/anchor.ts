/**
 * 선택 지점 옆 팝오버 좌표 (#66 UX) — 정정은 고칠 곳 **바로 옆**에서 시작해야 한다.
 *
 * 좌표는 **viewport 기준**이고 팝오버는 `position: fixed`로 띄운다. absolute로 문서 안에
 * 두면 하단 항목에서 팝오버가 컨테이너 밖으로 나가며 **문서의 스크롤 영역을 늘린다** —
 * 클릭만 했는데 화면이 움직이는 원인이었다. 떠 있는 UI는 문서 레이아웃에 영향을 주지 않는다.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface AnchorResult {
  /** viewport 기준 좌표 (position: fixed). */
  top: number;
  left: number;
  placement: 'below' | 'above';
}

const GAP = 8;
/** 화면 가장자리에서 최소한 띄우는 여백 — 딱 붙은 팝오버는 잘린 것처럼 보인다. */
const MARGIN = 8;

export function anchorPosition(
  target: Rect,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): AnchorResult {
  // 선택한 줄의 왼쪽에 맞추되 화면 밖으로 나가지 않게 당긴다 — 잘린 팝오버는 못 쓴다
  const maxLeft = viewport.width - popover.width - MARGIN;
  const left = Math.max(MARGIN, Math.min(target.left, Math.max(MARGIN, maxLeft)));

  const spaceBelow = viewport.height - (target.top + target.height);
  const spaceAbove = target.top;
  // 아래가 좁고 위가 넉넉하면 위로 — 위도 좁으면 아래로 되돌린다(위쪽 잘림이 더 나쁘다)
  if (spaceBelow < popover.height + GAP && spaceAbove > popover.height + GAP) {
    return { top: target.top - popover.height - GAP, left, placement: 'above' };
  }
  // 아래로 두되 화면 밖으로는 내리지 않는다
  const top = Math.min(target.top + target.height + GAP, viewport.height - popover.height - MARGIN);
  return { top: Math.max(MARGIN, top), left, placement: 'below' };
}
