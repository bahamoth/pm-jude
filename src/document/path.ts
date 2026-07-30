import type { RequirementsOutput } from '../prompts/requirements-v0';

/**
 * 문서 요소 주소 (#66, ADR-0016) — 부분 교정의 좌표.
 *
 * 화면에 보이는 한 줄이 하나의 주소를 갖고, 정정은 그 주소로 대상을 지목한다. 이 모듈이
 * 결정론적이어야 직접 편집(LLM을 거치지 않는 경로)이 성립한다 — 요청자가 쓴 문장이 다른
 * 무엇으로도 변형되지 않고 그 자리에 들어간다.
 *
 * 주소 문법은 화면 렌더(web-ui/lib/document.ts)와 같다:
 *   problem · users[0] · scope.inScope[2] · scope.outOfScope[1]
 *   stories[0].story · stories[0].acceptanceCriteria[1].ears · …[1].gwt
 *   dataSources[0] · openIssues[2].question
 */

/** 알 수 없는 주소 — 오타를 조용히 무시하지 않는다 (미등록 MIME 거부와 같은 정신). */
export class UnknownDocumentPathError extends Error {}

/** 정정 1건 — 주소와 그 자리에 들어갈 텍스트. */
export interface DocumentCorrection {
  path: string;
  text: string;
}

const GWT_PATTERN = /^Given\s+(.+?)\s+\/\s+When\s+(.+?)\s+\/\s+Then\s+(.+)$/;

/** GWT는 세 필드지만 화면에는 한 줄로 보인다 — 읽기·쓰기 모두 그 한 줄을 다룬다. */
function formatGwt(gwt: { given: string; when: string; then: string }): string {
  return `Given ${gwt.given} / When ${gwt.when} / Then ${gwt.then}`;
}

function parseGwt(text: string): { given: string; when: string; then: string } {
  const match = GWT_PATTERN.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      'GWT는 "Given … / When … / Then …" 형식이어야 한다 — 세 부분이 아니면 구조가 깨진다',
    );
  }
  return { given: match[1].trim(), when: match[2].trim(), then: match[3].trim() };
}

/** 배열 인덱스 접근을 검증한다 — 범위를 넘으면 주소 오류다. */
function at<T>(items: readonly T[], index: number, path: string): T {
  const item = items[index];
  if (item === undefined) throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
  return item;
}

function parseIndex(raw: string | undefined, path: string): number {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
  }
  return index;
}

/** 주소를 세그먼트로 쪼갠다: `stories[0].acceptanceCriteria[1].ears` → [stories, 0, …]. */
function segmentsOf(path: string): Array<string | number> {
  if (!/^[A-Za-z][A-Za-z0-9]*(\[\d+\]|\.[A-Za-z][A-Za-z0-9]*)*$/.test(path)) {
    throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
  }
  const segments: Array<string | number> = [];
  for (const token of path.split('.')) {
    const [, name, ...indices] = /^([A-Za-z][A-Za-z0-9]*)((?:\[\d+\])*)$/.exec(token) ?? [];
    if (!name) throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
    segments.push(name);
    for (const bracket of indices.join('').match(/\[\d+\]/g) ?? []) {
      segments.push(parseIndex(bracket.slice(1, -1), path));
    }
  }
  return segments;
}

/**
 * 줄 단위로 다룰 수 있는 배열 경로 (#66) — 한 줄이 한 항목인 것만.
 *
 * 스토리·수용기준은 여기 없다: 한 줄이 한 항목이 아니라 story/ears/gwt가 겹쳐 있어,
 * 줄 수가 바뀌었을 때 무엇이 추가·삭제된 것인지 정해지지 않는다.
 */
const LINE_ARRAY_PATHS = [
  'users',
  'dataSources',
  'scope.inScope',
  'scope.outOfScope',
  'openIssues',
];

export function isLineArrayPath(path: string): boolean {
  return LINE_ARRAY_PATHS.includes(path);
}

/** 배열 경로의 현재 값 — 항목을 줄바꿈으로 이어 한 편집 대상으로 만든다. */
function readLineArray(content: RequirementsOutput, path: string): string {
  switch (path) {
    case 'users':
      return content.users.join('\n');
    case 'dataSources':
      return content.dataSources.join('\n');
    case 'scope.inScope':
      return content.scope.inScope.join('\n');
    case 'scope.outOfScope':
      return content.scope.outOfScope.join('\n');
    case 'openIssues':
      return content.openIssues.map((issue) => issue.question).join('\n');
    default:
      throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
  }
}

/** 줄을 항목으로 — 빈 줄은 세지 않는다(편집 중 생긴 여백이 빈 요구가 되지 않게). */
function linesToItems(text: string, path: string): string[] {
  const items = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (items.length === 0) {
    throw new Error(`정정 텍스트가 비어 있다: ${path}`);
  }
  return items;
}

/** 주소가 가리키는 현재 값. 화면에 보이는 그 문자열이다. */
export function readDocumentPath(content: RequirementsOutput, path: string): string {
  if (isLineArrayPath(path)) return readLineArray(content, path);
  const segments = segmentsOf(path);
  const fail = (): never => {
    throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
  };

  const [head, ...rest] = segments;
  switch (head) {
    case 'problem':
      return rest.length === 0 ? content.problem : fail();
    case 'users':
      return rest.length === 1 && typeof rest[0] === 'number'
        ? at(content.users, rest[0], path)
        : fail();
    case 'dataSources':
      return rest.length === 1 && typeof rest[0] === 'number'
        ? at(content.dataSources, rest[0], path)
        : fail();
    case 'scope': {
      const [group, index] = rest;
      if ((group !== 'inScope' && group !== 'outOfScope') || typeof index !== 'number')
        return fail();
      return at(content.scope[group], index, path);
    }
    case 'openIssues': {
      const [index, field] = rest;
      if (typeof index !== 'number' || field !== 'question') return fail();
      return at(content.openIssues, index, path).question;
    }
    case 'stories': {
      const [storyIndex, field, ...tail] = rest;
      if (typeof storyIndex !== 'number') return fail();
      const story = at(content.stories, storyIndex, path);
      if (field === 'story' && tail.length === 0) return story.story;
      if (field !== 'acceptanceCriteria') return fail();
      const [acIndex, acField] = tail;
      if (typeof acIndex !== 'number') return fail();
      const criterion = at(story.acceptanceCriteria, acIndex, path);
      if (acField === 'ears') return criterion.ears;
      if (acField === 'gwt') return formatGwt(criterion.gwt);
      return fail();
    }
    default:
      return fail();
  }
}

/**
 * 지목한 주소만 바꾼 새 문서를 만든다 — 원본은 변형하지 않는다(이전 버전은 영속된 정본이다).
 *
 * 하나라도 주소가 틀리면 전부 거부한다: 문서를 반쯤 고쳐 놓는 것이 가장 나쁜 결과다.
 * 삭제·추가는 이 함수의 일이 아니다 — 빈 텍스트를 거부해 실수로 지우는 경로를 막는다.
 */
export function applyDocumentCorrections(
  content: RequirementsOutput,
  corrections: readonly DocumentCorrection[],
): RequirementsOutput {
  if (corrections.length === 0) return content;
  for (const correction of corrections) {
    if (isLineArrayPath(correction.path)) {
      linesToItems(correction.text, correction.path); // 항목이 하나도 없으면 여기서 멈춘다
    } else if (!correction.text.trim()) {
      throw new Error(`정정 텍스트가 비어 있다: ${correction.path}`);
    }
    readDocumentPath(content, correction.path); // 주소 검증 — 틀리면 여기서 멈춘다
  }

  const next: RequirementsOutput = structuredClone(content);
  for (const { path, text } of corrections) {
    // 배열 경로는 줄 단위로 항목을 다시 만든다 — 줄이 늘면 추가, 줄면 삭제 (#66)
    if (isLineArrayPath(path)) {
      const items = linesToItems(text, path);
      switch (path) {
        case 'users':
          next.users = items;
          break;
        case 'dataSources':
          next.dataSources = items;
          break;
        case 'scope.inScope':
          next.scope.inScope = items;
          break;
        case 'scope.outOfScope':
          next.scope.outOfScope = items;
          break;
        default:
          // 오픈이슈는 질문만 줄 단위다 — slotKey·담당자는 편집 대상이 아니라 자리를 지킨다
          next.openIssues = items.map((question, i) => {
            const existing = content.openIssues[i];
            return existing ? { ...existing, question } : { slotKey: '', question, assignee: null };
          });
      }
      continue;
    }
    const value = text.trim();
    const [head, ...rest] = segmentsOf(path);
    switch (head) {
      case 'problem':
        next.problem = value;
        break;
      case 'users':
        next.users[rest[0] as number] = value;
        break;
      case 'dataSources':
        next.dataSources[rest[0] as number] = value;
        break;
      case 'scope':
        next.scope[rest[0] as 'inScope' | 'outOfScope'][rest[1] as number] = value;
        break;
      case 'openIssues':
        at(next.openIssues, rest[0] as number, path).question = value;
        break;
      case 'stories': {
        const story = at(next.stories, rest[0] as number, path);
        if (rest[1] === 'story') {
          story.story = value;
          break;
        }
        const criterion = at(story.acceptanceCriteria, rest[2] as number, path);
        if (rest[3] === 'ears') criterion.ears = value;
        else criterion.gwt = parseGwt(value);
        break;
      }
      default:
        throw new UnknownDocumentPathError(`문서에 없는 주소: ${path}`);
    }
  }
  return next;
}
