import { describe, expect, it } from 'vitest';
import { anchorPosition } from './anchor';

/**
 * 선택 지점 옆 팝오버 좌표 (#66 UX) — 정정은 고칠 곳 바로 옆에서 시작해야 한다.
 * DOM 없이 검증하려고 사각형 계산만 떼어냈다.
 */
const container = { top: 100, left: 50, width: 600, height: 800 };
const popover = { width: 320, height: 200 };

describe('anchorPosition', () => {
  it('선택한 줄 바로 아래, 그 줄 왼쪽에 맞춰 띄운다', () => {
    const target = { top: 300, left: 120, width: 200, height: 24 };

    expect(anchorPosition(target, container, popover, 1000)).toEqual({
      top: 300 - 100 + 24 + 8, // 컨테이너 기준 + 줄 높이 + 여백
      left: 120 - 50,
      placement: 'below',
    });
  });

  it('컨테이너 오른쪽을 넘지 않게 왼쪽으로 당긴다 — 팝오버가 잘리면 못 쓴다', () => {
    const target = { top: 300, left: 600, width: 40, height: 24 };

    const { left } = anchorPosition(target, container, popover, 1000);

    expect(left).toBe(600 - 320); // 컨테이너 폭 - 팝오버 폭
  });

  it('왼쪽으로도 넘치면 0에 붙인다 — 컨테이너보다 넓은 팝오버', () => {
    const narrow = { top: 100, left: 50, width: 200, height: 800 };
    const target = { top: 300, left: 60, width: 40, height: 24 };

    expect(anchorPosition(target, narrow, popover, 1000).left).toBe(0);
  });

  it('아래 공간이 부족하면 선택 위에 띄운다 — 화면 밖으로 밀려나지 않게', () => {
    const target = { top: 900, left: 120, width: 200, height: 24 };

    const { top, placement } = anchorPosition(target, container, popover, 1000);

    expect(placement).toBe('above');
    expect(top).toBe(900 - 100 - 200 - 8); // 컨테이너 기준 - 팝오버 높이 - 여백
  });

  it('위로도 공간이 없으면 아래로 되돌린다 — 잘리더라도 위쪽 잘림보다 낫다', () => {
    const target = { top: 120, left: 120, width: 200, height: 24 };

    // 아래 공간 부족(뷰포트 200) + 위 공간도 부족(target.top이 컨테이너 상단 근처)
    expect(anchorPosition(target, container, popover, 200).placement).toBe('below');
  });
});
