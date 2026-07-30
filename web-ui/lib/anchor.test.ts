import { describe, expect, it } from 'vitest';
import { anchorPosition } from './anchor';

/**
 * 선택 지점 옆 팝오버 좌표 (#66 UX) — 좌표는 viewport 기준이다(position: fixed).
 * 문서 안에 absolute로 두면 하단 항목에서 스크롤 영역이 늘어나 화면이 튄다.
 */
const viewport = { width: 800, height: 600 };
const popover = { width: 320, height: 200 };

describe('anchorPosition', () => {
  it('선택한 줄 바로 아래, 그 줄 왼쪽에 맞춰 띄운다', () => {
    const target = { top: 200, left: 120, width: 200, height: 24 };

    expect(anchorPosition(target, popover, viewport)).toEqual({
      top: 200 + 24 + 8,
      left: 120,
      placement: 'below',
    });
  });

  it('화면 오른쪽을 넘지 않게 왼쪽으로 당긴다 — 잘린 팝오버는 못 쓴다', () => {
    const target = { top: 200, left: 700, width: 40, height: 24 };

    expect(anchorPosition(target, popover, viewport).left).toBe(800 - 320 - 8);
  });

  it('화면보다 넓은 팝오버는 왼쪽 여백에 붙인다', () => {
    const target = { top: 200, left: 60, width: 40, height: 24 };

    expect(anchorPosition(target, { width: 900, height: 200 }, viewport).left).toBe(8);
  });

  it('아래 공간이 부족하면 선택 위에 띄운다 — 문서 하단 항목의 경로', () => {
    const target = { top: 500, left: 120, width: 200, height: 24 };

    expect(anchorPosition(target, popover, viewport)).toMatchObject({
      top: 500 - 200 - 8,
      placement: 'above',
    });
  });

  it('위로도 공간이 없으면 아래로 되돌리되 화면 안에 붙인다', () => {
    const target = { top: 120, left: 120, width: 24, height: 24 };
    const tall = { width: 320, height: 560 };

    const result = anchorPosition(target, tall, { width: 800, height: 600 });

    expect(result.placement).toBe('below');
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.top + tall.height).toBeLessThanOrEqual(600);
  });
});
