import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { aggregateRetro, renderRetroReport, type RetroAggregateInput } from '../analysis/aggregate';
import { fetchLinearArchive, type LinearArchiveIssue } from '../analysis/linear-archive';
import {
  createAnalysisRegistry,
  REQUESTION_CLASSIFICATION_V0,
  type RequestionClassification,
} from '../analysis/requestion-classification-v0';
import { AgentSdkBackend } from '../gateway/agent-sdk-backend';
import { LlmGateway } from '../gateway/gateway';
import { setupBackendLog } from '../log/setup';

// 소급 아카이브 분석 CLI (#9, ADR-0004) — 배선만 하고 로직은 src/analysis에 둔다.
//   pnpm retro extract --team ENG [--months 9] [--out data/retro/archive.json]   (LINEAR_API_KEY 필요)
//   pnpm retro classify [--in data/retro/archive.json] [--out data/retro/classifications.json] [--model id]
//   → classifications.json을 운영자가 검수·수정한 뒤:
//   pnpm retro report [--in data/retro/classifications.json] [--out data/retro/report.md]

const { values, positionals } = parseArgs({
  options: {
    team: { type: 'string' },
    months: { type: 'string', default: '9' },
    in: { type: 'string' },
    out: { type: 'string' },
    model: { type: 'string' },
  },
  allowPositionals: true,
});

setupBackendLog('retro'); // 이후의 모든 콘솔 출력이 data/logs/retro.log에도 남는다 (#55)

const command = positionals[0];
const ARCHIVE_DEFAULT = 'data/retro/archive.json';
const CLASSIFICATIONS_DEFAULT = 'data/retro/classifications.json';

function writeOut(path: string, content: string) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.error(`저장됨: ${target}`);
}

interface ClassificationsFile {
  meta: { teamKey: string; since: string; promptRef: string; modelVersion: string };
  items: Array<{
    issue: { identifier: string; reopenCount: number; descriptionEditCount: number };
    classification: RequestionClassification;
  }>;
}

if (command === 'extract') {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey || !values.team) {
    console.error('사용법: LINEAR_API_KEY=... pnpm retro extract --team <KEY> [--months 9]');
    process.exit(1);
  }
  const since = new Date(Date.now() - Number(values.months) * 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const issues = await fetchLinearArchive({ apiKey, teamKey: values.team, since });
  const truncated = issues.filter((issue) => issue.commentsTruncated);
  if (truncated.length) {
    console.error(
      `주의 — 코멘트가 잘린 이슈 ${String(truncated.length)}건: ${truncated
        .map((issue) => issue.identifier)
        .join(', ')}`,
    );
  }
  writeOut(
    values.out ?? ARCHIVE_DEFAULT,
    JSON.stringify({ meta: { teamKey: values.team, since }, issues }, null, 2),
  );
  console.error(`이슈 ${String(issues.length)}건 추출 (${since} 이후)`);
} else if (command === 'classify') {
  const archivePath = resolve(values.in ?? ARCHIVE_DEFAULT);
  const archive = JSON.parse(readFileSync(archivePath, 'utf8')) as {
    meta: { teamKey: string; since: string };
    issues: LinearArchiveIssue[];
  };
  const gateway = new LlmGateway({
    backend: new AgentSdkBackend(values.model ? { model: values.model } : {}),
    registry: createAnalysisRegistry(),
  });
  const modelVersion = values.model ?? 'agent-sdk-default';
  const items: ClassificationsFile['items'] = [];
  for (const issue of archive.issues) {
    if (issue.comments.length === 0) {
      items.push({
        issue: {
          identifier: issue.identifier,
          reopenCount: issue.reopenCount,
          descriptionEditCount: issue.descriptionEditCount,
        },
        classification: { requestions: [] },
      });
      continue;
    }
    console.error(`분류 중: ${issue.identifier} (코멘트 ${String(issue.comments.length)}건)`);
    const result = await gateway.complete<RequestionClassification>(REQUESTION_CLASSIFICATION_V0, {
      issue: {
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        comments: issue.comments.map(({ index, author, body }) => ({ index, author, body })),
      },
    });
    items.push({
      issue: {
        identifier: issue.identifier,
        reopenCount: issue.reopenCount,
        descriptionEditCount: issue.descriptionEditCount,
      },
      classification: result.output,
    });
  }
  const file: ClassificationsFile = {
    meta: { ...archive.meta, promptRef: REQUESTION_CLASSIFICATION_V0, modelVersion },
    items,
  };
  writeOut(values.out ?? CLASSIFICATIONS_DEFAULT, JSON.stringify(file, null, 2));
  console.error('분류 완료 — 운영자 검수 후 `pnpm retro report`를 실행한다.');
} else if (command === 'report') {
  const file = JSON.parse(
    readFileSync(resolve(values.in ?? CLASSIFICATIONS_DEFAULT), 'utf8'),
  ) as ClassificationsFile;
  const markdown = renderRetroReport(
    aggregateRetro(file.items as RetroAggregateInput[]),
    file.meta,
  );
  if (values.out) writeOut(values.out, markdown);
  else console.log(markdown);
} else {
  console.error('사용법: pnpm retro <extract|classify|report> — 헤더 주석 참조');
  process.exit(1);
}
