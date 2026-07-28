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

  it('제목·필드·섹션·불릿·수용기준·오픈이슈·각주를 텍스트 파서와 같은 구조로 만든다', () => {
    const lines = documentLinesFromContent(content, { version: 2, transcriptCount: 6 });

    expect(lines[0]).toEqual({ kind: 'title', text: 'requirements 문서 v2' });
    expect(lines[1]).toEqual({
      kind: 'field',
      label: '문제',
      text: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
    });
    expect(lines[2]).toEqual({ kind: 'field', label: '사용자', text: '영업팀 매니저, 영업사원' });
    expect(lines[3]).toEqual({
      kind: 'field',
      label: '스코프',
      text: '포함: 월별 매출 추이 조회 / 제외: 실시간 알림',
    });
    expect(lines).toContainEqual({ kind: 'section', label: '유저스토리·수용기준', text: '' });
    expect(lines).toContainEqual({
      kind: 'bullet',
      text: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
    });
    expect(lines).toContainEqual({
      kind: 'sub',
      text: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
    });
    expect(lines).toContainEqual({
      kind: 'gwt',
      text: 'Given 매출 데이터가 존재할 때 / When 기간을 선택하면 / Then 월별 합계가 표시된다',
    });
    // 빈 데이터 소스는 오픈이슈로 안내한다 — 코어 formatDocument와 같은 문구
    expect(lines).toContainEqual({
      kind: 'field',
      label: '데이터 소스',
      text: '미확정 (오픈이슈 참조)',
    });
    expect(lines).toContainEqual({
      kind: 'section',
      label: '오픈이슈',
      text: '(요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)',
    });
    expect(lines).toContainEqual({
      kind: 'bullet',
      text: '[data-source] 데이터 출처 확정 필요 — 담당: 미지정',
    });
    expect(lines.at(-1)).toEqual({ kind: 'note', text: '원문 전사 6건 보존됨 (세션 저장소)' });
  });

  it('오픈이슈가 없으면 오픈이슈 섹션을 만들지 않는다', () => {
    const lines = documentLinesFromContent(
      { ...content, dataSources: ['CRM'], openIssues: [] },
      { version: 1, transcriptCount: 4 },
    );
    expect(lines.some((line) => line.kind === 'section' && line.label === '오픈이슈')).toBe(false);
    expect(lines).toContainEqual({ kind: 'field', label: '데이터 소스', text: 'CRM' });
  });
});
