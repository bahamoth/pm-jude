// requirements 문서 표시 라인 생성.
// 정본 경로: documentLinesFromContent — API가 내려주는 저장 구조체(requirements_doc.content,
// #53)를 그대로 라인으로 만든다. 폴백 경로: parseDocumentText — 저장 행이 없는 레거시
// 세션에서 코어 formatDocument(src/runner/core-runner.ts)의 게시 텍스트를 역파싱한다.

import type { DocumentContent } from './types';

export type DocLine =
  | { kind: 'title'; text: string }
  | { kind: 'field'; label: string; text: string }
  | { kind: 'section'; label: string; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'gwt'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'text'; text: string };

/**
 * 저장 구조체 → 표시 라인 (#53). 코어 formatDocument와 같은 구조·문구를 만들어
 * 두 경로(구조체/레거시 텍스트)의 화면이 갈라지지 않게 한다.
 */
export function documentLinesFromContent(
  content: DocumentContent,
  meta: { version: number; transcriptCount: number },
): DocLine[] {
  const lines: DocLine[] = [
    { kind: 'title', text: `requirements 문서 v${String(meta.version)}` },
    { kind: 'field', label: '문제', text: content.problem },
    { kind: 'field', label: '사용자', text: content.users.join(', ') },
    {
      kind: 'field',
      label: '스코프',
      text:
        `포함: ${content.scope.inScope.join(', ')}` +
        (content.scope.outOfScope.length ? ` / 제외: ${content.scope.outOfScope.join(', ')}` : ''),
    },
    { kind: 'section', label: '유저스토리·수용기준', text: '' },
  ];
  for (const story of content.stories) {
    lines.push({ kind: 'bullet', text: story.story });
    for (const criterion of story.acceptanceCriteria) {
      lines.push({ kind: 'sub', text: criterion.ears });
      lines.push({
        kind: 'gwt',
        text: `Given ${criterion.gwt.given} / When ${criterion.gwt.when} / Then ${criterion.gwt.then}`,
      });
    }
  }
  lines.push({
    kind: 'field',
    label: '데이터 소스',
    text: content.dataSources.join(', ') || '미확정 (오픈이슈 참조)',
  });
  if (content.openIssues.length) {
    lines.push({
      kind: 'section',
      label: '오픈이슈',
      text: '(요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)',
    });
    for (const issue of content.openIssues) {
      lines.push({
        kind: 'bullet',
        text: `[${issue.slotKey}] ${issue.question} — 담당: ${issue.assignee ?? '미지정'}`,
      });
    }
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
