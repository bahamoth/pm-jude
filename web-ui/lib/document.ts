// 코어 러너 formatDocument(src/runner/core-runner.ts)가 만드는 requirements 텍스트의
// 표시용 파서 — 형태가 어긋나는 줄은 일반 텍스트로 강등한다(파싱 실패가 표시 실패가 되지 않게).

export type DocLine =
  | { kind: 'title'; text: string }
  | { kind: 'field'; label: string; text: string }
  | { kind: 'section'; label: string; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'gwt'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'text'; text: string };

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
