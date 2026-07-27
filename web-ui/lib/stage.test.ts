import { describe, expect, it } from 'vitest';
import {
  allSlotsConfirmed,
  fullyPromoted,
  isLastRound,
  journeyStep,
  roundFailed,
  statusChip,
} from './stage';
import type { SlotView, Utterance } from './types';

function slot(partial: Partial<SlotView> & Pick<SlotView, 'slotKey' | 'state'>): SlotView {
  return {
    label: partial.slotKey,
    value: null,
    confirmedByRequester: false,
    openIssueAssignee: null,
    ...partial,
  };
}

function said(authorType: Utterance['authorType']): Utterance {
  return {
    seq: 1,
    authorType,
    originalText: '…',
    originalLanguage: 'ko',
    createdAt: '2026-07-27T00:00:00.000Z',
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

describe('미완 라운드 판정 (G-10)', () => {
  it('처리 중이 아닌데 마지막 발화가 요청자면 라운드가 죽은 것이다', () => {
    expect(roundFailed('clarifying', [said('requester'), said('agent')], false)).toBe(false);
    expect(roundFailed('clarifying', [said('agent'), said('requester')], false)).toBe(true);
    // 정정 재판정이 죽은 documented 세션도 재시도 대상이다
    expect(roundFailed('documented', [said('agent'), said('requester')], false)).toBe(true);
  });

  it('처리 중이면 실패가 아니다 — 대기 화면의 몫', () => {
    expect(roundFailed('clarifying', [said('agent'), said('requester')], true)).toBe(false);
    expect(roundFailed('intake', [said('requester')], true)).toBe(false);
  });

  it('intake는 질문이 아직 없으므로 처리 중이 아니면 실패다', () => {
    expect(roundFailed('intake', [said('requester')], false)).toBe(true);
  });

  it('종결된 세션은 재시도 대상이 아니다 — 재개는 입력으로 (#30)', () => {
    expect(roundFailed('closed', [said('agent'), said('requester')], false)).toBe(false);
  });
});

describe('문서 화면의 정직 표시 (G-11)', () => {
  it('확인 가능한 슬롯이 모두 확인되면 완주다 — 승격 슬롯은 분모가 아니다', () => {
    const filled = slot({ slotKey: 'purpose', state: 'filled', confirmedByRequester: true });
    const promoted = slot({ slotKey: 'data-source', state: 'promoted' });
    expect(allSlotsConfirmed([filled, promoted])).toBe(true);
    expect(allSlotsConfirmed([filled, slot({ slotKey: 'target-user', state: 'filled' })])).toBe(
      false,
    );
    expect(allSlotsConfirmed([promoted])).toBe(false); // 확인할 것이 없으면 완주도 없다
  });

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
