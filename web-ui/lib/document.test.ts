import { describe, expect, it } from 'vitest';
import { parseDocumentText } from './document';

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
