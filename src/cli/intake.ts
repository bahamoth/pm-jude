import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AgentSdkBackend } from '../gateway/agent-sdk-backend';
import { setupBackendLog } from '../log/setup';
import { createDefaultRegistry } from '../prompts/catalog';
import { runClarificationSession } from '../runner/local-runner';
import { SessionStore } from '../store/session-store';

// 로컬 인테이크 CLI — 채널 어댑터의 가장 얇은 형태. 배선만 하고 로직은 러너에 둔다.
//   pnpm intake "<요청 문장>" [--lang ko] [--channel web|slack] [--model <id>] [--db <path>]
//   pnpm intake --export        # 저장된 전 세션을 익명화 JSON으로 출력 (골든셋 시드)

const { values, positionals } = parseArgs({
  options: {
    lang: { type: 'string', default: 'ko' },
    channel: { type: 'string', default: 'web' },
    model: { type: 'string' },
    db: { type: 'string' },
    export: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

// --export는 세션 데이터를 stdout으로 내보내는 경로라 로그 사본 대상이 아니다 (#55)
if (!values.export) setupBackendLog('intake');

const dbPath = resolve(values.db ?? process.env.PMJUDE_DB_PATH ?? './data/pm-jude.db');
mkdirSync(dirname(dbPath), { recursive: true });
const store = SessionStore.open(dbPath);

try {
  if (values.export) {
    console.log(JSON.stringify(store.exportSessions(), null, 2));
  } else {
    const request = positionals.join(' ').trim();
    if (!request) {
      console.error(
        '사용법: pnpm intake "<요청 문장>" [--lang ko] [--channel web|slack] [--model <id>] [--db <path>]\n' +
          '       pnpm intake --export',
      );
      process.exit(1);
    }
    if (values.channel !== 'web' && values.channel !== 'slack') {
      console.error(`--channel은 web 또는 slack이어야 한다: "${values.channel}"`);
      process.exit(1);
    }

    const result = await runClarificationSession(
      {
        store,
        backend: new AgentSdkBackend(values.model ? { model: values.model } : {}),
        registry: createDefaultRegistry(),
        modelVersion: values.model ?? 'agent-sdk-default',
        usageLogger: {
          log: (entry) =>
            console.error(
              `[usage] ${entry.promptRef} 시도${entry.attempt} ${entry.outcome} ${entry.durationMs}ms` +
                (entry.usage
                  ? ` in:${entry.usage.inputTokens} out:${entry.usage.outputTokens}`
                  : ''),
            ),
        },
      },
      { request, requesterLanguage: values.lang, channel: values.channel },
    );

    console.log(`세션 ${result.sessionId} — ${dbPath}에 영속 저장됨\n`);
    if (result.interpretations.length > 1) {
      console.log('해석 후보:');
      for (const interpretation of result.interpretations) console.log(`  · ${interpretation}`);
      console.log('');
    }
    result.questions.forEach((question, index) => {
      const target =
        question.target.type === 'slot'
          ? `슬롯 ${question.target.slotKey}`
          : `모호성 — ${question.target.description}`;
      console.log(`Q${index + 1}. ${question.question}  (${target})`);
      for (const option of question.exampleOptions) console.log(`    - ${option}`);
      console.log(`    - ${question.dontKnowPath.label}`);
    });
  }
} finally {
  store.close();
}
