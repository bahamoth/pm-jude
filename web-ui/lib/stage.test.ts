import { describe, expect, it } from 'vitest';
import { isLastRound, journeyStep, statusChip } from './stage';

describe('상태 → 여정·칩 매핑', () => {
  it('상태별 여정 단계 — 보류는 ② 내용 정리에 머문다', () => {
    expect(journeyStep('intake')).toBe(1);
    expect(journeyStep('clarifying')).toBe(2);
    expect(journeyStep('documented')).toBe(3);
    expect(journeyStep('closed')).toBe(2);
  });

  it('상태 칩 — 요청자 차례(action)가 구분된다 (M-1)', () => {
    expect(statusChip('clarifying', null).tone).toBe('action');
    expect(statusChip('documented', null).tone).toBe('action');
    expect(statusChip('intake', null).tone).toBe('progress');
    expect(statusChip('closed', 'on_hold_insufficient_info')).toMatchObject({ tone: 'hold' });
    expect(statusChip('closed', 'rejected').tone).toBe('done');
  });

  it('마지막 라운드 예고 — 예산 소진 시점에만 참', () => {
    expect(isLastRound(1, 3)).toBe(false);
    expect(isLastRound(3, 3)).toBe(true);
    expect(isLastRound(4, 6)).toBe(false); // 재개로 예산이 늘어난 경우
  });
});
