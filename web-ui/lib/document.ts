// requirements 문서 표시 라인 생성.
// 정본 경로: documentLinesFromContent — API가 내려주는 저장 구조체(requirements_doc.content,
// #53)를 그대로 라인으로 만든다. 폴백 경로: parseDocumentText — 저장 행이 없는 레거시
// 세션에서 코어 formatDocument(src/runner/core-runner.ts)의 게시 텍스트를 역파싱한다.

import type { DocumentContent } from './types';

/**
 * 문서 요소의 안정적 주소 (#66, ADR-0016) — 부분 교정의 좌표.
 *
 * 정정은 이 주소로 대상을 지목하고, 드래그 선택은 선택 범위가 걸친 주소 집합으로 환원된다.
 * 주소가 붙는 것은 **교정 대상 요소**뿐이다 — 제목·구분선은 문서의 내용이 아니라 표시 장치다.
 */
export type DocPath = string;

export type DocLine = (
  | { kind: 'title'; text: string }
  | { kind: 'field'; label: string; text: string }
  | { kind: 'section'; label: string; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'gwt'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'text'; text: string }
  // 규범 다이어그램 (F3 v2.0, ADR-0018 — #70). 제목과 mermaid 본문이 각각 교정 주소를 갖는다.
  | {
      kind: 'diagramTitle';
      text: string;
      diagramId: string;
      diagramKind: 'flow' | 'state' | 'hierarchy' | 'screen';
      sourceAttachmentRef: string | null;
    }
  | { kind: 'diagram'; text: string; diagramId: string }
) & { path?: DocPath; label?: string };

/**
 * 저장 구조체 → 표시 라인 (#53). 코어 formatDocument와 같은 구조·문구를 만들어
 * 두 경로(구조체/레거시 텍스트)의 화면이 갈라지지 않게 한다.
 */
export function documentLinesFromContent(
  content: DocumentContent,
  meta: { version: number; transcriptCount: number },
): DocLine[] {
  // 배열은 항목마다 한 라인이다 (#66) — 쉼표로 이어 붙이면 읽을 수도, 지목할 수도 없다
  const lines: DocLine[] = [
    { kind: 'title', text: `requirements 문서 v${String(meta.version)}` },
    { kind: 'field', label: '문제', text: content.problem, path: 'problem' },
    { kind: 'section', label: '사용자', text: '' },
  ];
  content.users.forEach((user, i) => {
    lines.push({ kind: 'bullet', text: user, path: `users[${String(i)}]` });
  });
  lines.push({ kind: 'section', label: '스코프 — 포함', text: '' });
  content.scope.inScope.forEach((item, i) => {
    lines.push({ kind: 'bullet', text: item, path: `scope.inScope[${String(i)}]` });
  });
  if (content.scope.outOfScope.length) {
    lines.push({ kind: 'section', label: '스코프 — 제외', text: '' });
    content.scope.outOfScope.forEach((item, i) => {
      lines.push({ kind: 'bullet', text: item, path: `scope.outOfScope[${String(i)}]` });
    });
  }
  lines.push({ kind: 'section', label: '유저스토리·수용기준', text: '' });
  content.stories.forEach((story, si) => {
    lines.push({ kind: 'bullet', text: story.story, path: `stories[${String(si)}].story` });
    story.acceptanceCriteria.forEach((criterion, ci) => {
      const base = `stories[${String(si)}].acceptanceCriteria[${String(ci)}]`;
      lines.push({ kind: 'sub', text: criterion.ears, path: `${base}.ears` });
      lines.push({
        kind: 'gwt',
        text: `Given ${criterion.gwt.given} / When ${criterion.gwt.when} / Then ${criterion.gwt.then}`,
        path: `${base}.gwt`,
      });
    });
  });
  lines.push({ kind: 'section', label: '데이터 소스', text: '' });
  if (content.dataSources.length === 0) {
    lines.push({ kind: 'text', text: '미확정 (오픈이슈 참조)' });
  } else {
    content.dataSources.forEach((source, i) => {
      lines.push({ kind: 'bullet', text: source, path: `dataSources[${String(i)}]` });
    });
  }
  // 규범 다이어그램 (v2.0, ADR-0018) — 제목·mermaid 본문이 각각 교정 대상이다.
  // 확인 배지·버튼은 표시 계층 몫: 확인 상태는 문서가 아니라 세션(diagramStates)이 든다.
  if (content.diagrams?.length) {
    lines.push({ kind: 'section', label: '규범 다이어그램', text: '' });
    content.diagrams.forEach((diagram, i) => {
      lines.push({
        kind: 'diagramTitle',
        text: diagram.title,
        diagramId: diagram.id,
        diagramKind: diagram.kind,
        sourceAttachmentRef: diagram.sourceAttachmentRef,
        path: `diagrams[${String(i)}].title`,
      });
      lines.push({
        kind: 'diagram',
        text: diagram.mermaid,
        diagramId: diagram.id,
        path: `diagrams[${String(i)}].mermaid`,
      });
    });
  }
  if (content.openIssues.length) {
    lines.push({
      kind: 'section',
      label: '오픈이슈',
      text: '(요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)',
    });
    content.openIssues.forEach((issue, i) => {
      lines.push({
        kind: 'bullet',
        text: `[${issue.slotKey}] ${issue.question} — 담당: ${issue.assignee ?? '미지정'}`,
        path: `openIssues[${String(i)}].question`,
      });
    });
  }
  lines.push({
    kind: 'note',
    text: `원문 전사 ${String(meta.transcriptCount)}건 보존됨 (세션 저장소)`,
  });
  return lines;
}

export function parseDocumentText(raw: string): DocLine[] {
  const lines: DocLine[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const field = /^\*(.+?)\*\s+—\s+(.*)$/.exec(line);
    if (field?.[1] !== undefined && field[2] !== undefined) {
      lines.push({ kind: 'field', label: field[1], text: field[2] });
      continue;
    }
    const section = /^\*(.+?)\*\s*(.*)$/.exec(line);
    if (section?.[1] !== undefined) {
      if (lines.length === 0) lines.push({ kind: 'title', text: section[1] });
      else lines.push({ kind: 'section', label: section[1], text: section[2] ?? '' });
      continue;
    }
    if (/^• /.test(line)) {
      lines.push({ kind: 'bullet', text: line.replace(/^• /, '') });
      continue;
    }
    if (/^\s+Given /.test(line)) {
      lines.push({ kind: 'gwt', text: line.trim() });
      continue;
    }
    if (/^\s+- /.test(line)) {
      lines.push({ kind: 'sub', text: line.trim().replace(/^- /, '') });
      continue;
    }
    if (/^_.*_$/.test(line)) {
      lines.push({ kind: 'note', text: line.replaceAll(/^_|_$/g, '') });
      continue;
    }
    lines.push({ kind: 'text', text: line });
  }
  return lines;
}
