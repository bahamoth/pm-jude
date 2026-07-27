import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROW_LEFT_PATH,
  BROW_RIGHT_PATH,
  BUBBLE_PATH,
  EYE,
  HEAD,
  JUDE_STATES,
  TASH_LEFT_PATH,
  TASH_RIGHT_PATH,
  TUNING,
  judeState,
} from './jude-geometry';

const read = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

describe('정적 자산과 컴포넌트 지오메트리 일치', () => {
  const full = read('jude.svg');
  const mark = read('jude-mark.svg');

  it('말풍선 경로가 두 자산과 컴포넌트에서 같다', () => {
    expect(full).toContain(BUBBLE_PATH);
    expect(mark).toContain(BUBBLE_PATH);
  });

  it('콧수염 경로가 jude.svg와 같다', () => {
    expect(full).toContain(TASH_LEFT_PATH);
    expect(full).toContain(TASH_RIGHT_PATH);
  });

  it('파비콘형에는 콧수염도 눈썹도 없다 — 16px에서 뭉개진다', () => {
    expect(mark).not.toContain(TASH_LEFT_PATH);
    expect(mark).not.toContain(TASH_RIGHT_PATH);
    expect(mark).not.toContain(BROW_LEFT_PATH);
    expect(mark).not.toContain(BROW_RIGHT_PATH);
  });

  it('눈 위치와 머리 기울기가 자산과 같다', () => {
    for (const svg of [full, mark]) {
      expect(svg).toContain(`cx="${EYE.left}" cy="${EYE.cy}"`);
      expect(svg).toContain(`cx="${EYE.right}" cy="${EYE.cy}"`);
      expect(svg).toContain(`rotate(${HEAD.restTilt} ${HEAD.originX} ${HEAD.originY})`);
    }
  });

  it('콧수염 확정 수치가 자산의 transform과 일치한다', () => {
    // scaleX를 x=16.5 기준으로 적용한 값 — translate(16.5 * (1 - width))
    const shift = +(16.5 * (1 - TUNING.tashWidth)).toFixed(2);
    expect(full).toContain(`translate(${shift} 0) scale(${TUNING.tashWidth} 1)`);
    expect(full).toContain(`stroke-width="${TUNING.tashStroke}"`);
    expect(full).toContain(`translate(${-TUNING.tashGap} 0)`);
    expect(full).toContain(`translate(${TUNING.tashGap} 0)`);
  });

  it('두 자산 모두 currentColor로만 칠한다', () => {
    for (const svg of [full, mark]) {
      expect(svg).not.toMatch(/(fill|stroke)="#[0-9a-fA-F]{3,8}"/);
    }
  });
});

describe('세션 상태 → 표정', () => {
  const base = { status: 'clarifying', terminalState: null, processing: false } as const;

  it('실패가 무엇보다 앞선다', () => {
    expect(judeState({ ...base, failed: true, typing: true, processing: true })).toBe('failed');
  });

  it('입력 중이면 듣는다', () => {
    expect(judeState({ ...base, typing: true })).toBe('listening');
  });

  it('서버가 도는 중이면 생각한다', () => {
    expect(judeState({ ...base, processing: true })).toBe('thinking');
  });

  it('접수 직후는 질문을 만드는 중이다', () => {
    expect(judeState({ ...base, status: 'intake' })).toBe('thinking');
  });

  it('명확화 중이면 묻는다', () => {
    expect(judeState(base)).toBe('asking');
  });

  it('문서가 나오면 완료다', () => {
    expect(judeState({ ...base, status: 'documented' })).toBe('resolved');
  });

  it('정보 부족 종결만 보류로 읽는다', () => {
    expect(
      judeState({ ...base, status: 'closed', terminalState: 'on_hold_insufficient_info' }),
    ).toBe('onhold');
    expect(judeState({ ...base, status: 'closed', terminalState: 'issue_created' })).toBe(
      'resolved',
    );
  });

  it('모든 세션 상태가 정의된 표정으로 간다', () => {
    for (const status of ['intake', 'clarifying', 'documented', 'closed'] as const) {
      expect(JUDE_STATES).toContain(judeState({ ...base, status }));
    }
  });
});
