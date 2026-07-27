import { describe, expect, it } from 'vitest';
import { fullyPromoted, isLastRound, journeyStep, roundFailed, statusChip } from './stage';
import type { SlotView } from './types';

function slot(partial: Partial<SlotView> & Pick<SlotView, 'slotKey' | 'state'>): SlotView {
  return {
    label: partial.slotKey,
    value: null,
    confirmedByRequester: false,
    openIssueAssignee: null,
    ...partial,
  };
}

describe('상태 → 여정·칩 매핑', () => {
  it('상태별 여정 단계 — 보류는 ② 내용 정리에 머문다', () => {
    expect(journeyStep('intake')).toBe(1);
    expect(journeyStep('clarifying')).toBe(2);
    expect(journeyStep('documented')).toBe(3);
    expect(journeyStep('closed')).toBe(2);
  });

  it('칩 라벨은 사전 키로만 내보낸다 — 문자열을 직접 담지 않는다', () => {
    expect(statusChip('clarifying', null).labelKey).toBe('chip.clarifying');
    expect(statusChip('closed', 'on_hold_insufficient_info').labelKey).toBe('chip.onHold');
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

describe('미완 라운드 노출 (G-10)', () => {
  it('서버가 미완 라운드를 알리고 처리 중이 아니면 재시도를 드러낸다', () => {
    expect(roundFailed('judgement', false)).toBe(true);
    expect(roundFailed('clarification', false)).toBe(true);
    expect(roundFailed(null, false)).toBe(false);
  });

  it('처리 중이면 실패가 아니다 — 대기 화면의 몫', () => {
    expect(roundFailed('judgement', true)).toBe(false);
    expect(roundFailed('clarification', true)).toBe(false);
  });
});

describe('문서 화면의 정직 표시 (G-11)', () => {
  it('전 슬롯이 승격이면 전면 승격 문서로 구분된다 (#28 S-5)', () => {
    expect(fullyPromoted([slot({ slotKey: 'a', state: 'promoted' })])).toBe(true);
    expect(
      fullyPromoted([
        slot({ slotKey: 'a', state: 'promoted' }),
        slot({ slotKey: 'b', state: 'filled' }),
      ]),
    ).toBe(false);
    expect(fullyPromoted([])).toBe(false);
  });
});
