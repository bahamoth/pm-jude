import { describe, expect, it } from 'vitest';
import { slotActionOf } from './slot-actions';

describe('슬롯 확인 카드의 행동 결정 (#51)', () => {
  it('미확인 충족 슬롯은 맞아요/아니에요 둘 다 받는다', () => {
    expect(slotActionOf({ state: 'filled', confirmedByRequester: false })).toBe(
      'confirm-or-correct',
    );
  });

  it('확인된 슬롯도 정정 진입점은 유지한다 — 완주 후에도 문서를 고칠 수 있다 (#51)', () => {
    expect(slotActionOf({ state: 'filled', confirmedByRequester: true })).toBe('correct-only');
  });

  it('승격·미충족 슬롯은 확인 대상이 아니다', () => {
    expect(slotActionOf({ state: 'promoted', confirmedByRequester: false })).toBe('none');
    expect(slotActionOf({ state: 'unfilled', confirmedByRequester: false })).toBe('none');
  });
});
