import type { Rect } from './anchor';
import type { DocLine } from './document';

/**
 * 드래그 선택 → 문서 주소 (#66, ADR-0016 결정 2).
 *
 * 선택은 요소 경계를 넘을 수 있다 — 사람이 문서를 읽다 짚는 방식이 그렇다. 그래서 선택이
 * 걸친 라인 구간을 받아 그 안의 주소를 모은다. 주소 없는 라인(제목·구분선)은 문서의 내용이
 * 아니므로 건너뛴다.
 *
 * DOM에 의존하지 않는 순수 함수다 — Selection API가 주는 것을 라인 인덱스로 환원해 넘긴다.
 */
export function pathsInRange(
  lines: ReadonlyArray<Pick<DocLine, 'path'>>,
  fromIndex: number,
  toIndex: number,
): string[] {
  const start = Math.max(0, Math.min(fromIndex, toIndex));
  const end = Math.min(lines.length - 1, Math.max(fromIndex, toIndex));
  const paths: string[] = [];
  for (let i = start; i <= end; i++) {
    const path = lines[i]?.path;
    if (path) paths.push(path);
  }
  return paths;
}

/** 선택 결과 — 주소·인용문과 팝오버를 띄울 화면 좌표(viewport 기준). */
export interface DocSelection {
  paths: string[];
  quotedText: string;
  rect: Rect;
}

/**
 * 현재 브라우저 선택이 걸친 문서 주소를 읽는다 — `data-doc-path`가 심긴 요소를 훑는다.
 * 선택이 없거나 문서 밖이면 null. 선택 원문과 좌표를 함께 돌려준다 — 정정 입력이 고칠 곳
 * 바로 옆에서 열려야 하기 때문이다 (#66 UX).
 */
export function readSelectionPaths(container: HTMLElement | null): DocSelection | null {
  if (!container) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const paths: string[] = [];
  for (const element of container.querySelectorAll<HTMLElement>('[data-doc-path]')) {
    if (range.intersectsNode(element)) {
      const path = element.dataset.docPath;
      if (path) paths.push(path);
    }
  }
  if (paths.length === 0) return null;
  const box = range.getBoundingClientRect();
  return {
    paths,
    quotedText: selection.toString().trim(),
    rect: { top: box.top, left: box.left, width: box.width, height: box.height },
  };
}

/** 요소 하나를 지목한 선택 — 항목 클릭은 그 줄을 고른 선택이다. */
export function selectionFromElement(element: HTMLElement): DocSelection | null {
  const path = element.dataset.docPath;
  if (!path) return null;
  const box = element.getBoundingClientRect();
  return {
    paths: [path],
    quotedText: '',
    rect: { top: box.top, left: box.left, width: box.width, height: box.height },
  };
}

/** 줄 단위로 함께 편집할 수 있는 배열 경로 (#66) — 코어 src/document/path.ts와 같은 목록. */
const LINE_ARRAY_PATHS = [
  'users',
  'dataSources',
  'scope.inScope',
  'scope.outOfScope',
  'openIssues',
];

/**
 * 선택한 주소들이 한 배열의 형제인지 — 그렇다면 여러 줄을 한 번에 고칠 수 있다.
 * `scope.inScope[0]`·`scope.inScope[2]` → `scope.inScope`. 이종 요소가 섞이면 null.
 */
export function commonArrayPath(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const groups = new Set(
    paths.map((path) => {
      const match = /^(.+)\[\d+\](?:\.[A-Za-z][A-Za-z0-9]*)?$/.exec(path);
      return match?.[1] ?? path;
    }),
  );
  if (groups.size !== 1) return null;
  const [group] = [...groups];
  return group && LINE_ARRAY_PATHS.includes(group) ? group : null;
}
