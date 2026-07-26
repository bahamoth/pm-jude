import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SessionStore } from '../store/session-store';
import { renderTraceHtml } from '../trace/render-html';
import { buildTraceData } from '../trace/trace-data';

// 세션 트레이스 뷰어 생성 CLI — 배선만 하고 조형·렌더링은 src/trace에 둔다.
//   pnpm trace [--db <path>] [--out <path>]
// 기본: data/pm-jude.db → DB 옆 trace.html

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    out: { type: 'string' },
  },
});

const dbPath = resolve(values.db ?? process.env.PMJUDE_DB_PATH ?? './data/pm-jude.db');
const outPath = resolve(values.out ?? join(dirname(dbPath), 'trace.html'));

const store = SessionStore.open(dbPath);
try {
  const data = buildTraceData(
    store.exportSessions(),
    store.listVersionRegistry(),
    new Date().toISOString(),
  );
  writeFileSync(outPath, renderTraceHtml(data));
  console.log(`trace: 세션 ${data.summary.sessionCount}건 → ${outPath}`);
} finally {
  store.close();
}
