import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AgentSdkBackend } from '../gateway/agent-sdk-backend';
import { createDefaultRegistry } from '../prompts/catalog';
import { SessionStore } from '../store/session-store';
import { createWebServer } from '../web/server';

// 웹 어댑터 배선 (#16, ADR-0007) — 배선만 하고 로직은 코어 러너에 둔다.
//   실행: pnpm web   (기본 http://127.0.0.1:8787 — PMJUDE_WEB_PORT로 변경)
// 간이 식별만 있는 로컬 PoC 서버라 루프백에만 바인딩한다.

const dbPath = resolve(process.env.PMJUDE_DB_PATH ?? './data/pm-jude.db');
mkdirSync(dirname(dbPath), { recursive: true });
const store = SessionStore.open(dbPath);

const model = process.env.PMJUDE_MODEL;
const server = createWebServer({
  store,
  backend: new AgentSdkBackend(model ? { model } : {}),
  registry: createDefaultRegistry(),
  modelVersion: model ?? 'agent-sdk-default',
  usageLogger: {
    log: (entry) =>
      console.error(
        `[usage] ${entry.promptRef} 시도${entry.attempt} ${entry.outcome} ${entry.durationMs}ms` +
          (entry.usage ? ` in:${entry.usage.inputTokens} out:${entry.usage.outputTokens}` : ''),
      ),
  },
  teamLanguage: process.env.PMJUDE_TEAM_LANGUAGE ?? 'ko',
  ...(process.env.PMJUDE_MAX_ROUNDS ? { maxRounds: Number(process.env.PMJUDE_MAX_ROUNDS) } : {}),
});

const port = Number(process.env.PMJUDE_WEB_PORT ?? 8787);
server.listen(port, '127.0.0.1', () => {
  console.error(`pm-jude 웹 러너 가동 — http://127.0.0.1:${String(port)} · 세션 저장소: ${dbPath}`);
});
