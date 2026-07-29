import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import App from '@slack/bolt';
import { AgentSdkBackend } from '../gateway/agent-sdk-backend';
import { setupBackendLog } from '../log/setup';
import { createDefaultRegistry } from '../prompts/catalog';
import { SlackIntakeRunner } from '../runner/slack-runner';
import { SessionStore } from '../store/session-store';

// Slack PoC 러너 배선 (#8) — Bolt Socket Mode. 배선만 하고 로직은 러너에 둔다.
//   실행: pnpm slack   (SLACK_BOT_TOKEN·SLACK_APP_TOKEN 필요 — .env.example 참조)
// 앱 생성·토큰 발급·채널 선정은 운영자 작업이다 (이슈 보드 #8).

setupBackendLog('slack'); // 이후의 모든 콘솔 출력이 data/logs/slack.log에도 남는다 (#55)

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
if (!botToken || !appToken) {
  console.error(
    'SLACK_BOT_TOKEN과 SLACK_APP_TOKEN이 필요하다 — Slack 앱 생성 후 .env에 채운다 (.env.example 참조).',
  );
  process.exit(1);
}

const dbPath = resolve(process.env.PMJUDE_DB_PATH ?? './data/pm-jude.db');
mkdirSync(dirname(dbPath), { recursive: true });
const store = SessionStore.open(dbPath);

const app = new App({ token: botToken, appToken, socketMode: true });
const model = process.env.PMJUDE_MODEL;
const runner = new SlackIntakeRunner({
  store,
  backend: new AgentSdkBackend(model ? { model } : {}),
  registry: createDefaultRegistry(),
  modelVersion: model ?? 'agent-sdk-default',
  slack: {
    postMessage: async ({ channel, threadTs, text }) => {
      await app.client.chat.postMessage({ channel, thread_ts: threadTs, text });
    },
  },
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

app.event('app_mention', async ({ event }) => {
  await runner.handleMention({
    channel: event.channel,
    threadTs: event.thread_ts ?? event.ts,
    userId: event.user ?? 'unknown',
    text: event.text,
  });
});

app.message(async ({ message, context }) => {
  // 스레드의 일반 사용자 메시지만 답변으로 취급 — 봇 메시지·멘션(app_mention이 처리)은 제외
  if (message.subtype !== undefined) return;
  if (!('thread_ts' in message) || !message.thread_ts) return;
  if (!('user' in message) || !message.user) return;
  const text = 'text' in message ? (message.text ?? '') : '';
  if (context.botUserId && text.includes(`<@${context.botUserId}>`)) return;

  await runner.handleThreadReply({
    channel: message.channel,
    threadTs: message.thread_ts,
    userId: message.user,
    text,
  });
});

await app.start();
console.error(`pm-jude Slack 러너 가동 — 세션 저장소: ${dbPath}`);
