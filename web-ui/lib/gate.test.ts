import { describe, expect, it } from 'vitest';
import { closedCardKind, decisionReady, gateWaiting, rejectReasonKey } from './gate';

describe('종결 카드 종류 (F8 #69)', () => {
  it('terminalState별로 카드가 갈린다', () => {
    expect(closedCardKind('issue_created')).toBe('issue');
    expect(closedCardKind('backlog')).toBe('backlog');
    expect(closedCardKind('rejected')).toBe('rejected');
    expect(closedCardKind('on_hold_insufficient_info')).toBe('onHold');
  });

  it('미지의 종결 상태는 generic으로 폴백한다 — 화면이 깨지지 않는다 (중복 병합 등 미래 상태)', () => {
    expect(closedCardKind('duplicate_merge')).toBe('generic');
    expect(closedCardKind(null)).toBe('generic');
  });
});

describe('거절 사유 표기', () => {
  it('통제된 태그는 사전 키로 간다', () => {
    expect(rejectReasonKey('priority')).toBe('reason.priority');
    expect(rejectReasonKey('out_of_scope')).toBe('reason.out_of_scope');
    expect(rejectReasonKey('duplicate')).toBe('reason.duplicate');
    expect(rejectReasonKey('technically_infeasible')).toBe('reason.technically_infeasible');
    expect(rejectReasonKey('insufficient_info')).toBe('reason.insufficient_info');
  });

  it('미지의 태그는 null — 화면은 태그 원문으로 폴백한다', () => {
    expect(rejectReasonKey('whatever')).toBeNull();
    expect(rejectReasonKey(null)).toBeNull();
  });
});

describe('결정 커밋 가드 (P-U1 — 제출 후 실패 금지)', () => {
  it('질문은 노트가 있어야 한다 — 공백만으로는 부족하다', () => {
    expect(decisionReady('question', {})).toBe(false);
    expect(decisionReady('question', { note: '   ' })).toBe(false);
    expect(decisionReady('question', { note: '기존 리포트와 무엇이 다른가요?' })).toBe(true);
  });

  it('거절은 사유 태그가 있어야 한다', () => {
    expect(decisionReady('reject', {})).toBe(false);
    expect(decisionReady('reject', { reasonTag: 'duplicate' })).toBe(true);
  });

  it('승인·백로그는 추가 입력 없이 커밋 가능하다', () => {
    expect(decisionReady('approve', {})).toBe(true);
    expect(decisionReady('backlog', {})).toBe(true);
  });
});

describe('검토 대기 판정 (F5 #69)', () => {
  it('documented + 미결정 게이트 항목일 때만 참', () => {
    expect(gateWaiting('documented', { decision: null })).toBe(true);
    expect(gateWaiting('documented', { decision: 'approve' })).toBe(false);
    expect(gateWaiting('documented', null)).toBe(false);
    expect(gateWaiting('mockup', { decision: null })).toBe(false);
    expect(gateWaiting('closed', { decision: null })).toBe(false);
  });
});
