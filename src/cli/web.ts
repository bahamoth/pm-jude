import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../config';
import { NotionConnector } from '../connect/notion';
import { createDefaultExtractorRegistry } from '../extract/registry';
import { AgentSdkBackend } from '../gateway/agent-sdk-backend';
import { createFakeBackend } from '../gateway/fake-backend';
import { setupBackendLog } from '../log/setup';
import { ThemeRegistry } from '../mockup/theme-registry';
import { createDefaultRegistry } from '../prompts/catalog';
import { AttachmentStore } from '../store/attachment-store';
import { SessionStore } from '../store/session-store';
import { createWebServer } from '../web/server';

// 웹 어댑터 배선 (#16, ADR-0007) — 배선만 하고 로직은 코어 러너에 둔다.
//   실행: pnpm web   (기본 http://127.0.0.1:8787)
//   설정: 기본값 → pm-jude.config.json → 환경변수 (#59, ADR-0015 — .env.example 참조)
//   UI 개발·데모: PMJUDE_FAKE_BACKEND=1 pnpm web  (LLM 자격 증명 불필요, 결정론적 시나리오)
// 간이 식별만 있는 로컬 PoC 서버라 루프백에만 바인딩한다.

const config = loadConfig(); // 설정 오류는 로그 티 설치 전이라 콘솔로 죽는다 — 그걸로 충분하다
setupBackendLog('web', config.log.file); // 이후의 모든 콘솔 출력이 data/logs/web.log에도 남는다 (#55)

const fake = config.llm.fakeBackend;
const dbPath = resolve(fake ? config.db.fakePath : config.db.path);
mkdirSync(dirname(dbPath), { recursive: true });
const store = SessionStore.open(dbPath);

// 첨부 원본 저장소 (F1-Attach) — 내용 주소 기반이라 세션 DB와 분리해 둔다.
// 원본에는 삭제 경로가 없다: 보존 기간이 정해지면 그때 일괄 정리한다(PRD §12-20).
const attachmentsRoot = resolve(config.attachments.path);
mkdirSync(attachmentsRoot, { recursive: true });

// 디자인 시스템 선정 후보 (F4, #54) — 조직 표준 테마는 코드 수정 없이 디렉터리 등록으로 흡수한다
// (*.theme.json 디자인 토큰 / *.theme.css). 미지정이면 내장 프리셋만.
const themes = ThemeRegistry.withBuiltins();
if (config.mockup.themeDir) {
  const loaded = themes.loadDirectory(resolve(config.mockup.themeDir));
  console.error(`[web] 외부 테마 ${String(loaded)}건 등록 — ${config.mockup.themeDir}`);
}

const registry = createDefaultRegistry();
const model = config.llm.model;
if (fake) console.error('[web] 가짜 백엔드 모드 — 데모·UI 검증 전용, LLM 호출 없음');
const server = createWebServer({
  store,
  backend: fake ? createFakeBackend(registry) : new AgentSdkBackend(model ? { model } : {}),
  registry,
  modelVersion: fake ? 'fake-backend' : (model ?? 'agent-sdk-default'),
  usageLogger: {
    log: (entry) =>
      console.error(
        `[usage] ${entry.promptRef} 시도${entry.attempt} ${entry.outcome} ${entry.durationMs}ms` +
          (entry.usage ? ` in:${entry.usage.inputTokens} out:${entry.usage.outputTokens}` : ''),
      ),
  },
  teamLanguage: config.intake.teamLanguage,
  maxRounds: config.intake.maxRounds,
  maxUtteranceChars: config.intake.maxUtteranceChars,
  maxMockupIterations: config.mockup.maxIterations,
  condense: config.condense,
  llm: { timeoutMs: config.llm.timeoutMs, maxConcurrency: config.llm.maxConcurrency },
  limits: {
    maxBytesPerFile: config.attachments.maxBytesPerFile,
    maxPerSession: config.attachments.maxPerSession,
    maxSessionTextChars: config.attachments.maxSessionTextChars,
  },
  attachmentStore: new AttachmentStore(attachmentsRoot),
  // 추출기는 러너의 게이트웨이를 받는다 — 이미지 추출도 같은 폭주 상한 아래 놓인다
  createExtractors: createDefaultExtractorRegistry,
  // 노션 커넥터 (#57, ADR-0013) — 토큰 없으면 꺼짐, URL은 텍스트로 남는다
  ...(config.notion.apiKey ? { notion: new NotionConnector({ token: config.notion.apiKey }) } : {}),
  themes,
});

const port = config.web.port;
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `포트 ${String(port)}가 이미 사용 중이다 — 이전 pnpm web이 떠 있는지 확인:\n` +
        `  lsof -ti:${String(port)} | xargs kill\n` +
        `다른 포트로 띄우려면: PMJUDE_WEB_PORT=8788 pnpm dev`,
    );
    process.exit(1);
  }
  throw error;
});
server.listen(port, '127.0.0.1', () => {
  console.error(`pm-jude 웹 러너 가동 — http://127.0.0.1:${String(port)} · 세션 저장소: ${dbPath}`);
});
