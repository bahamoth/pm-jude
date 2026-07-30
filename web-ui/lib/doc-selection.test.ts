import { describe, expect, it } from 'vitest';
import { pathsInRange } from './doc-selection';

/**
 * 드래그 선택 → 문서 주소 (#66, ADR-0016 결정 2).
 * DOM에 의존하지 않도록 「선택에 걸친 요소들」을 입력으로 받는 순수 함수로 둔다 —
 * 브라우저 Selection API가 주는 것을 이 형태로 환원해 넘긴다.
 */
const lines = [
  { path: undefined },
  { path: 'problem' },
  { path: 'users[0]' },
  { path: 'scope.inScope[0]' },
  { path: 'scope.inScope[1]' },
  { path: undefined },
  { path: 'stories[0].story' },
];

describe('pathsInRange', () => {
  it('선택 범위에 걸친 주소만 순서대로 모은다', () => {
    expect(pathsInRange(lines, 2, 4)).toEqual(['users[0]', 'scope.inScope[0]', 'scope.inScope[1]']);
  });

  it('주소 없는 라인(제목·구분선)은 건너뛴다 — 문서의 내용이 아니다', () => {
    expect(pathsInRange(lines, 0, 2)).toEqual(['problem', 'users[0]']);
    expect(pathsInRange(lines, 5, 6)).toEqual(['stories[0].story']);
  });

  it('한 줄만 선택해도 그 주소 하나가 대상이다 — 항목 클릭과 같은 결과', () => {
    expect(pathsInRange(lines, 3, 3)).toEqual(['scope.inScope[0]']);
  });

  it('역방향 선택(아래에서 위로 드래그)도 같은 결과를 준다', () => {
    expect(pathsInRange(lines, 4, 2)).toEqual(pathsInRange(lines, 2, 4));
  });

  it('범위를 벗어난 인덱스는 잘라서 다룬다 — 선택이 문서 밖으로 나가도 죽지 않는다', () => {
    expect(pathsInRange(lines, -3, 1)).toEqual(['problem']);
    expect(pathsInRange(lines, 6, 99)).toEqual(['stories[0].story']);
  });

  it('주소가 하나도 없는 범위는 빈 배열 — 정정 대상이 없다', () => {
    expect(pathsInRange([{ path: undefined }], 0, 0)).toEqual([]);
  });
});
