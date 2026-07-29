import { describe, expect, it } from 'vitest';
import { classifyResultMessage } from '../src/gateway/agent-sdk-backend';

/**
 * SDK 결과 분류 (#65) — query() 호출 없이 판정 규칙만 검증한다.
 * 한도·차단 응답이 정상 출력으로 흘러가면 게이트웨이가 스키마 위반으로 오진한다.
 */
describe('SDK 결과 분류', () => {
  it('subtype이 success이고 오류 표시가 없으면 정상 출력이다', () => {
    expect(
      classifyResultMessage({ subtype: 'success', is_error: false, result: '{"a":1}' }),
    ).toEqual({ kind: 'ok', outputText: '{"a":1}' });
  });

  it('subtype이 success여도 is_error면 차단으로 본다 — 한도 안내가 이 경로로 온다', () => {
    const verdict = classifyResultMessage({
      subtype: 'success',
      is_error: true,
      result: "You've reached your usage limit. Resets at 3pm.",
    });

    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') expect(verdict.reason).toContain('usage limit');
  });

  it('api_error_status가 있으면 그 코드를 사유에 남긴다', () => {
    const verdict = classifyResultMessage({
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result: 'rate limited',
    });

    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') expect(verdict.reason).toContain('429');
  });

  it('success가 아닌 subtype은 실행 실패다 — 차단과 구분한다', () => {
    const verdict = classifyResultMessage({
      subtype: 'error_max_turns',
      is_error: true,
      result: '',
    });

    expect(verdict.kind).toBe('failed');
    if (verdict.kind === 'failed') expect(verdict.reason).toContain('error_max_turns');
  });
});
