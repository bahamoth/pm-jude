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

/**
 * 현재 브라우저 선택이 걸친 문서 주소를 읽는다 — `data-doc-path`가 심긴 요소를 훑는다.
 * 선택이 없거나 문서 밖이면 빈 배열. 선택 원문도 함께 돌려준다(지시의 초점이 된다).
 */
export function readSelectionPaths(container: HTMLElement | null): {
  paths: string[];
  quotedText: string;
} {
  const empty = { paths: [], quotedText: '' };
  if (!container) return empty;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return empty;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return empty;

  const paths: string[] = [];
  for (const element of container.querySelectorAll<HTMLElement>('[data-doc-path]')) {
    if (range.intersectsNode(element)) {
      const path = element.dataset.docPath;
      if (path) paths.push(path);
    }
  }
  return { paths, quotedText: selection.toString().trim() };
}
