import type { RequestionClassification } from './requestion-classification-v0';

export interface RetroAggregateInput {
  issue: { identifier: string; reopenCount: number; descriptionEditCount: number };
  classification: RequestionClassification;
}

export interface RetroReport {
  /** §10 감소율 지표의 분모가 되는 도입 전 기준 수치. */
  baseline: {
    issueCount: number;
    issuesWithRequestions: number;
    requestionCount: number;
    requestionsPerIssue: number;
    requestionIssueRatio: number;
    reopenCount: number;
    descriptionEditCount: number;
  };
  /** 재질문 유형 분류표 — F2e 필수 슬롯 목록(#10)의 근거. 빈도 내림차순. */
  typeTable: Array<{
    type: string;
    description: string;
    count: number;
    resolvable: number;
    unresolvable: number;
    unclear: number;
  }>;
}

/** 분류 결과의 결정론적 집계 — LLM 보조는 분류까지, 수치는 코드가 낸다 (원칙 2). */
export function aggregateRetro(items: RetroAggregateInput[]): RetroReport {
  const typeRows = new Map<string, RetroReport['typeTable'][number]>();
  let requestionCount = 0;
  let issuesWithRequestions = 0;
  let reopenCount = 0;
  let descriptionEditCount = 0;

  for (const item of items) {
    reopenCount += item.issue.reopenCount;
    descriptionEditCount += item.issue.descriptionEditCount;
    if (item.classification.requestions.length > 0) issuesWithRequestions++;
    for (const requestion of item.classification.requestions) {
      requestionCount++;
      const row = typeRows.get(requestion.type) ?? {
        type: requestion.type,
        description: requestion.typeDescription,
        count: 0,
        resolvable: 0,
        unresolvable: 0,
        unclear: 0,
      };
      row.count++;
      row[requestion.requesterResolvable]++;
      typeRows.set(requestion.type, row);
    }
  }

  return {
    baseline: {
      issueCount: items.length,
      issuesWithRequestions,
      requestionCount,
      requestionsPerIssue: items.length ? requestionCount / items.length : 0,
      requestionIssueRatio: items.length ? issuesWithRequestions / items.length : 0,
      reopenCount,
      descriptionEditCount,
    },
    typeTable: [...typeRows.values()].sort((a, b) => b.count - a.count),
  };
}

export interface RetroReportMeta {
  teamKey: string;
  since: string;
  promptRef: string;
  modelVersion: string;
}

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

/** 운영자 검수·PRD 첨부용 마크다운 리포트. 모든 수치는 버전 귀속을 병기한다 (F11). */
export function renderRetroReport(report: RetroReport, meta: RetroReportMeta): string {
  const { baseline } = report;
  const unresolvableCount = report.typeTable.reduce((sum, row) => sum + row.unresolvable, 0);
  const unresolvableRatio = baseline.requestionCount
    ? unresolvableCount / baseline.requestionCount
    : 0;

  const lines = [
    '# 소급 아카이브 분석 — 재질문 유형 분류표 + 베이스라인 (#9, ADR-0004)',
    '',
    `- 대상: Linear 팀 \`${meta.teamKey}\`, ${meta.since} 이후 생성 이슈 ${String(baseline.issueCount)}건`,
    `- 분류: \`${meta.promptRef}\` × \`${meta.modelVersion}\` (LLM 보조 + 운영자 검수)`,
    '',
    '## 베이스라인 (§10 감소율 지표의 분모)',
    '',
    `- 재질문 발생 이슈 비율: **${percent(baseline.requestionIssueRatio)}** (${String(baseline.issuesWithRequestions)}/${String(baseline.issueCount)})`,
    `- 이슈당 재질문 수: **${baseline.requestionsPerIssue.toFixed(2)}** (총 ${String(baseline.requestionCount)}건)`,
    `- reopen: ${String(baseline.reopenCount)}건 / 스펙(설명) 편집: ${String(baseline.descriptionEditCount)}건`,
    '',
    '## 재질문 유형 분류표 (F2e 필수 슬롯 초안 #10의 근거)',
    '',
    '| 유형 | 설명 | 빈도 | 해소 가능 | 해소 불가 | 불명 |',
    '|---|---|---|---|---|---|',
    ...report.typeTable.map(
      (row) =>
        `| \`${row.type}\` | ${row.description} | ${String(row.count)} | ${String(row.resolvable)} | ${String(row.unresolvable)} | ${String(row.unclear)} |`,
    ),
    '',
    '## 요청자 해소 불가 비율 (§2.1 전제 검증 — 중단 기준 (c)의 입력)',
    '',
    `- 전체 재질문 중 해소 불가: **${percent(unresolvableRatio)}** (${String(unresolvableCount)}/${String(baseline.requestionCount)})`,
    '- 이 비율이 다수이면 명확화 무게중심을 F2b(대화)에서 F2a(검색)·F2c(승격)로 옮긴다 — 실패가 아니라 설계 정보다.',
    '',
  ];
  return lines.join('\n');
}
