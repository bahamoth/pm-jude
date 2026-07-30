import { describe, expect, it } from 'vitest';
import { documentLinesFromContent, parseDocumentText } from './document';
import type { DocumentContent } from './types';

// 코어 formatDocument가 실제로 만드는 형태의 대표 표본 (tests/core-runner.test.ts 경로와 동일 계약)
const sample = [
  '*requirements v0*',
  '*문제* — 영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
  '*사용자* — 영업팀 매니저',
  '*유저스토리·수용기준*',
  '• 영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
  '   - When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
  '     Given 매출 데이터가 존재할 때 / When 기간을 선택하면 / Then 월별 합계가 표시된다',
  '*오픈이슈* (요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)',
  '• [data-source] 데이터 출처 확정 필요 — 담당: 미지정',
  '_원문 전사 4건 보존됨 (세션 저장소)_',
].join('\n');

describe('requirements 텍스트 표시용 파서', () => {
  it('제목·필드·섹션·불릿·수용기준·각주를 구분한다', () => {
    const lines = parseDocumentText(sample);

    expect(lines[0]).toEqual({ kind: 'title', text: 'requirements v0' });
    expect(lines[1]).toEqual({
      kind: 'field',
      label: '문제',
      text: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
    });
    expect(lines).toContainEqual({ kind: 'section', label: '유저스토리·수용기준', text: '' });
    expect(lines).toContainEqual({
      kind: 'bullet',
      text: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
    });
    expect(lines.filter((l) => l.kind === 'gwt')).toHaveLength(1);
    expect(lines.at(-1)).toEqual({ kind: 'note', text: '원문 전사 4건 보존됨 (세션 저장소)' });
  });

  it('규약 밖의 줄은 일반 텍스트로 강등된다 — 표시 실패 방어', () => {
    const lines = parseDocumentText('그냥 문장 하나\n\n또 하나');
    expect(lines).toEqual([
      { kind: 'text', text: '그냥 문장 하나' },
      { kind: 'text', text: '또 하나' },
    ]);
  });
});

describe('저장 구조체 렌더 (#53) — 역파싱 없이 API의 content로 같은 표시를 만든다', () => {
  const content: DocumentContent = {
    problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
    users: ['영업팀 매니저', '영업사원'],
    scope: { inScope: ['월별 매출 추이 조회'], outOfScope: ['실시간 알림'] },
    stories: [
      {
        story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
            gwt: {
              given: '매출 데이터가 존재할 때',
              when: '기간을 선택하면',
              then: '월별 합계가 표시된다',
            },
          },
        ],
      },
    ],
    dataSources: [],
    openIssues: [{ slotKey: 'data-source', question: '데이터 출처 확정 필요', assignee: null }],
  };

  /**
   * v0.2까지는 이 경로가 레거시 텍스트 파서와 같은 구조를 만들어야 했으나, #66에서 배열을
   * 항목 단위로 쪼개며 두 경로가 갈라졌다. 구조체 경로만 주소를 갖고 부분 교정을 지원한다 —
   * 텍스트에서 항목을 되쪼갤 수는 없다(항목 내부 쉼표와 구분이 불가능하다).
   */
  it('제목·문제·스토리·수용기준·오픈이슈·각주를 구조대로 만든다', () => {
    const lines = documentLinesFromContent(content, { version: 2, transcriptCount: 6 });

    expect(lines[0]).toEqual({ kind: 'title', text: 'requirements 문서 v2' });
    expect(lines[1]).toEqual({
      kind: 'field',
      label: '문제',
      text: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
      path: 'problem',
    });
    // 사용자·스코프는 섹션 + 항목 라인 (#66) — 쉼표로 이어 붙이지 않는다
    expect(lines).toContainEqual({ kind: 'section', label: '사용자', text: '' });
    expect(lines).toContainEqual({ kind: 'bullet', text: '영업팀 매니저', path: 'users[0]' });
    expect(lines).toContainEqual({ kind: 'section', label: '스코프 — 포함', text: '' });
    expect(lines).toContainEqual({
      kind: 'bullet',
      text: '월별 매출 추이 조회',
      path: 'scope.inScope[0]',
    });
    expect(lines).toContainEqual({ kind: 'section', label: '유저스토리·수용기준', text: '' });
    expect(lines).toContainEqual({
      kind: 'bullet',
      text: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
      path: 'stories[0].story',
    });
    expect(lines).toContainEqual({
      kind: 'sub',
      text: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
      path: 'stories[0].acceptanceCriteria[0].ears',
    });
    expect(lines).toContainEqual({
      kind: 'gwt',
      text: 'Given 매출 데이터가 존재할 때 / When 기간을 선택하면 / Then 월별 합계가 표시된다',
      path: 'stories[0].acceptanceCriteria[0].gwt',
    });
    // 빈 데이터 소스는 오픈이슈로 안내한다 — 지목할 항목이 없으니 주소도 없다
    expect(lines).toContainEqual({ kind: 'text', text: '미확정 (오픈이슈 참조)' });
    expect(lines).toContainEqual({
      kind: 'section',
      label: '오픈이슈',
      text: '(요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)',
    });
    expect(lines).toContainEqual({
      kind: 'bullet',
      text: '[data-source] 데이터 출처 확정 필요 — 담당: 미지정',
      path: 'openIssues[0].question',
    });
    expect(lines.at(-1)).toEqual({ kind: 'note', text: '원문 전사 6건 보존됨 (세션 저장소)' });
  });

  it('오픈이슈가 없으면 오픈이슈 섹션을 만들지 않는다', () => {
    const lines = documentLinesFromContent(
      { ...content, dataSources: ['CRM'], openIssues: [] },
      { version: 1, transcriptCount: 4 },
    );
    expect(lines.some((line) => line.kind === 'section' && line.label === '오픈이슈')).toBe(false);
    expect(lines).toContainEqual({ kind: 'bullet', text: 'CRM', path: 'dataSources[0]' });
  });

  it('레거시 텍스트 파서 경로는 주소를 만들지 않는다 — 부분 교정 불가가 정직한 상태다', () => {
    const lines = parseDocumentText(sample);

    expect(lines.every((line) => line.path === undefined)).toBe(true);
  });
});

describe('문서 요소 주소와 항목 단위 라인 (#66, ADR-0016)', () => {
  const content = {
    problem: '영업 실적을 정리해 볼 수단이 없다',
    users: ['영업팀 매니저', '영업사원'],
    scope: {
      inScope: ['월별 매출 추이 조회', '팀별 비교', '기간 필터'],
      outOfScope: ['실시간 알림', '예측'],
    },
    stories: [
      {
        story: '매니저로서 월별 추이를 보고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 기간을 고르면, the system shall 해당 구간의 추이를 표시한다',
            gwt: { given: '데이터가 있다', when: '기간을 고른다', then: '추이가 보인다' },
          },
        ],
      },
    ],
    dataSources: ['CRM', '사내 DB'],
    openIssues: [{ slotKey: 'auth', question: '권한 범위는?', assignee: null }],
  };

  it('배열 항목은 각자 한 라인이 된다 — 쉼표로 이어 붙이면 지목할 대상이 사라진다', () => {
    const lines = documentLinesFromContent(content, { version: 2, transcriptCount: 0 });

    const scopeItems = lines.filter((l) => l.path?.startsWith('scope.inScope['));
    expect(scopeItems).toHaveLength(3);
    expect(scopeItems[2]?.text).toBe('기간 필터');
    // 한 문자열로 뭉갠 라인이 남아 있지 않다
    expect(lines.some((l) => l.text.includes('월별 매출 추이 조회, 팀별 비교'))).toBe(false);
  });

  it('모든 교정 대상 요소가 안정적 주소를 갖는다 — 정정의 좌표', () => {
    const lines = documentLinesFromContent(content, { version: 2, transcriptCount: 0 });
    const paths = lines.map((l) => l.path).filter(Boolean);

    expect(paths).toContain('problem');
    expect(paths).toContain('users[0]');
    expect(paths).toContain('users[1]');
    expect(paths).toContain('scope.inScope[0]');
    expect(paths).toContain('scope.outOfScope[1]');
    expect(paths).toContain('stories[0].story');
    expect(paths).toContain('stories[0].acceptanceCriteria[0].ears');
    expect(paths).toContain('stories[0].acceptanceCriteria[0].gwt');
    expect(paths).toContain('dataSources[1]');
    expect(paths).toContain('openIssues[0].question');
  });

  it('주소는 중복되지 않는다 — 같은 좌표가 둘이면 정정이 어디로 갈지 정해지지 않는다', () => {
    const lines = documentLinesFromContent(content, { version: 2, transcriptCount: 0 });
    const paths = lines.map((l) => l.path).filter(Boolean) as string[];

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('제목·구분 라인처럼 교정 대상이 아닌 것에는 주소가 없다', () => {
    const lines = documentLinesFromContent(content, { version: 2, transcriptCount: 0 });

    expect(lines.find((l) => l.kind === 'title')?.path).toBeUndefined();
    expect(lines.filter((l) => l.kind === 'section').every((l) => l.path === undefined)).toBe(true);
  });
});
