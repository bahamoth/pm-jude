import { describe, expect, it } from 'vitest';
import {
  applyDocumentCorrections,
  readDocumentPath,
  UnknownDocumentPathError,
} from '../src/document/path';
import type { RequirementsOutput } from '../src/prompts/requirements-v0';

/**
 * 문서 요소 주소 (#66, ADR-0016) — 부분 교정의 좌표.
 * 이 함수가 결정론적이어야 직접 편집(LLM 없는 경로)이 성립한다.
 */
const doc: RequirementsOutput = {
  problem: '영업 실적을 정리해 볼 수단이 없다',
  users: ['영업팀 매니저', '영업사원'],
  scope: { inScope: ['월별 추이', '팀별 비교'], outOfScope: ['실시간 알림'] },
  stories: [
    {
      story: '매니저로서 월별 추이를 보고 싶다',
      acceptanceCriteria: [
        {
          ears: 'When 기간을 고르면, the system shall 추이를 표시한다',
          gwt: { given: '데이터가 있다', when: '기간을 고른다', then: '추이가 보인다' },
        },
      ],
    },
  ],
  dataSources: ['CRM'],
  openIssues: [{ slotKey: 'auth', question: '권한 범위는?', assignee: null }],
};

describe('readDocumentPath', () => {
  it('중첩 배열·객체 경로의 현재 값을 읽는다', () => {
    expect(readDocumentPath(doc, 'problem')).toBe('영업 실적을 정리해 볼 수단이 없다');
    expect(readDocumentPath(doc, 'users[1]')).toBe('영업사원');
    expect(readDocumentPath(doc, 'scope.inScope[0]')).toBe('월별 추이');
    expect(readDocumentPath(doc, 'scope.outOfScope[0]')).toBe('실시간 알림');
    expect(readDocumentPath(doc, 'stories[0].story')).toBe('매니저로서 월별 추이를 보고 싶다');
    expect(readDocumentPath(doc, 'stories[0].acceptanceCriteria[0].ears')).toContain(
      'the system shall',
    );
    expect(readDocumentPath(doc, 'dataSources[0]')).toBe('CRM');
    expect(readDocumentPath(doc, 'openIssues[0].question')).toBe('권한 범위는?');
  });

  it('gwt는 세 필드를 합친 한 줄로 읽는다 — 화면에 그렇게 보이고 그렇게 지목된다', () => {
    expect(readDocumentPath(doc, 'stories[0].acceptanceCriteria[0].gwt')).toBe(
      'Given 데이터가 있다 / When 기간을 고른다 / Then 추이가 보인다',
    );
  });

  it('없는 경로는 UnknownDocumentPathError로 거부한다 — 조용히 null을 주면 오타가 무시된다', () => {
    expect(() => readDocumentPath(doc, 'users[9]')).toThrow(UnknownDocumentPathError);
    expect(() => readDocumentPath(doc, 'nope')).toThrow(UnknownDocumentPathError);
    expect(() => readDocumentPath(doc, 'stories[0].acceptanceCriteria[5].ears')).toThrow(
      UnknownDocumentPathError,
    );
  });
});

describe('applyDocumentCorrections', () => {
  it('지목한 경로만 바꾸고 나머지는 그대로 둔다 — 부분 교정의 전부다', () => {
    const next = applyDocumentCorrections(doc, [
      { path: 'scope.inScope[1]', text: '팀별·개인별 비교' },
    ]);

    expect(next.scope.inScope).toEqual(['월별 추이', '팀별·개인별 비교']);
    // 나머지가 원본과 동일한 값이다
    expect(next.problem).toBe(doc.problem);
    expect(next.users).toEqual(doc.users);
    expect(next.stories).toEqual(doc.stories);
    expect(next.openIssues).toEqual(doc.openIssues);
  });

  it('원본을 변형하지 않는다 — 이전 버전은 영속된 정본이다', () => {
    const before = JSON.stringify(doc);

    applyDocumentCorrections(doc, [{ path: 'problem', text: '바뀐 문제' }]);

    expect(JSON.stringify(doc)).toBe(before);
  });

  it('여러 경로를 한 번에 바꾼다 — 드래그 선택이 여러 요소에 걸칠 수 있다', () => {
    const next = applyDocumentCorrections(doc, [
      { path: 'users[0]', text: '영업 리드' },
      { path: 'stories[0].acceptanceCriteria[0].ears', text: 'When A면, the system shall B한다' },
    ]);

    expect(next.users).toEqual(['영업 리드', '영업사원']);
    expect(next.stories[0]?.acceptanceCriteria[0]?.ears).toBe('When A면, the system shall B한다');
    expect(next.stories[0]?.acceptanceCriteria[0]?.gwt).toEqual(
      doc.stories[0]?.acceptanceCriteria[0]?.gwt,
    );
  });

  it('gwt 경로는 Given/When/Then 세 필드로 되돌려 적용한다', () => {
    const next = applyDocumentCorrections(doc, [
      {
        path: 'stories[0].acceptanceCriteria[0].gwt',
        text: 'Given 로그인했다 / When 조회하면 / Then 결과가 나온다',
      },
    ]);

    expect(next.stories[0]?.acceptanceCriteria[0]?.gwt).toEqual({
      given: '로그인했다',
      when: '조회하면',
      then: '결과가 나온다',
    });
  });

  it('gwt 형식이 어긋나면 거부한다 — 세 부분이 아닌 값을 넣으면 구조가 깨진다', () => {
    expect(() =>
      applyDocumentCorrections(doc, [
        { path: 'stories[0].acceptanceCriteria[0].gwt', text: '그냥 문장' },
      ]),
    ).toThrow(/Given/);
  });

  it('없는 경로는 거부한다 — 부분 적용으로 문서를 반쯤 고쳐 놓지 않는다', () => {
    expect(() =>
      applyDocumentCorrections(doc, [
        { path: 'problem', text: '유효한 변경' },
        { path: 'users[9]', text: '없는 항목' },
      ]),
    ).toThrow(UnknownDocumentPathError);
  });

  it('빈 텍스트는 거부한다 — 삭제는 이 경로의 일이 아니다', () => {
    expect(() => applyDocumentCorrections(doc, [{ path: 'problem', text: '   ' }])).toThrow(/비어/);
  });
});
