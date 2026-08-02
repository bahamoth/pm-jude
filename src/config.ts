import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * 레이어드 설정 (#59, ADR-0015) — 기본값 → 통합 설정 파일 → 환경변수, env가 최종 우선.
 *
 * 기본값의 단일 원천은 이 스키마다 — 엔트리포인트에 흩어져 있던 기본값 중복과
 * 아무도 읽지 않는 죽은 env 설정을 없앤다. 파일 부재는 정상이고, 깨진 파일·미지 키는
 * 기동을 거부한다(미등록 MIME 거부와 같은 철학 — 오타가 조용히 무시되면 운영자는
 * 설정이 반영됐다고 믿는다).
 *
 * 실파일(pm-jude.config.json)은 토큰을 담을 수 있어 gitignore 대상이다 —
 * 커밋되는 것은 pm-jude.config.example.json뿐 (ADR-0015 결정 2).
 */

const configSchema = z
  .object({
    web: z
      .object({ port: z.number().int().positive().default(8787) })
      .strict()
      .prefault({}),
    db: z
      .object({
        path: z.string().default('./data/pm-jude.db'),
        /** 가짜 백엔드 모드의 별도 저장소 — 데모 데이터가 실세션에 섞이지 않게. */
        fakePath: z.string().default('./data/pm-jude-fake.db'),
      })
      .strict()
      .prefault({}),
    attachments: z
      .object({
        path: z.string().default('./data/attachments'),
        maxBytesPerFile: z
          .number()
          .int()
          .positive()
          .default(20 * 1024 * 1024),
        maxPerSession: z.number().int().positive().default(10),
        maxSessionTextChars: z.number().int().positive().default(200_000),
      })
      .strict()
      .prefault({}),
    llm: z
      .object({
        /** null이면 Agent SDK 기본 모델. */
        model: z.string().nullable().default(null),
        fakeBackend: z.boolean().default(false),
        /** 게이트웨이 전역 상한 — 프롬프트 버전 선언이 있으면 그쪽이 우선한다 (#56). */
        timeoutMs: z.number().int().positive().default(120_000),
        maxConcurrency: z.number().int().positive().default(2),
      })
      .strict()
      .prefault({}),
    intake: z
      .object({
        teamLanguage: z.string().default('ko'),
        maxRounds: z.number().int().positive().default(3),
        maxUtteranceChars: z.number().int().positive().default(10_000),
      })
      .strict()
      .prefault({}),
    mockup: z
      .object({
        maxIterations: z.number().int().positive().default(3),
        themeDir: z.string().nullable().default(null),
      })
      .strict()
      .prefault({}),
    condense: z
      .object({
        targetChars: z.number().int().positive().default(16_000),
        budgetChars: z.number().int().positive().default(160_000),
      })
      .strict()
      .prefault({}),
    notion: z
      .object({ apiKey: z.string().nullable().default(null) })
      .strict()
      .prefault({}),
    slack: z
      .object({
        botToken: z.string().nullable().default(null),
        appToken: z.string().nullable().default(null),
      })
      .strict()
      .prefault({}),
    linear: z
      .object({
        apiKey: z.string().nullable().default(null),
        /** 이슈 생성 대상 팀 (F6, #69) — apiKey와 함께 있어야 실커넥터가 열린다. */
        teamId: z.string().nullable().default(null),
      })
      .strict()
      .prefault({}),
    log: z
      .object({
        /** null이면 엔트리포인트별 기본 경로 (data/logs/<name>.log — #55). */
        file: z.string().nullable().default(null),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({});

export type PmJudeConfig = z.infer<typeof configSchema>;

/** 설정이 기동을 막는 유일한 방식 — 사유가 담긴 명시적 실패. */
export class ConfigError extends Error {}

type EnvKind = 'string' | 'number' | 'boolean';
/** env var → 설정 경로 명시 매핑 — 기존 이름 전부 보존 (ADR-0015 결정 5). */
const ENV_MAPPING: ReadonlyArray<[envVar: string, path: [string, string], kind: EnvKind]> = [
  ['PMJUDE_WEB_PORT', ['web', 'port'], 'number'],
  ['PMJUDE_DB_PATH', ['db', 'path'], 'string'],
  ['PMJUDE_ATTACHMENTS_PATH', ['attachments', 'path'], 'string'],
  ['PMJUDE_MODEL', ['llm', 'model'], 'string'],
  ['PMJUDE_FAKE_BACKEND', ['llm', 'fakeBackend'], 'boolean'],
  ['PMJUDE_LLM_TIMEOUT_MS', ['llm', 'timeoutMs'], 'number'],
  ['PMJUDE_LLM_MAX_CONCURRENCY', ['llm', 'maxConcurrency'], 'number'],
  ['PMJUDE_TEAM_LANGUAGE', ['intake', 'teamLanguage'], 'string'],
  ['PMJUDE_MAX_ROUNDS', ['intake', 'maxRounds'], 'number'],
  ['PMJUDE_MAX_UTTERANCE_CHARS', ['intake', 'maxUtteranceChars'], 'number'],
  ['PMJUDE_MAX_MOCKUP_ITERATIONS', ['mockup', 'maxIterations'], 'number'],
  ['PMJUDE_THEME_DIR', ['mockup', 'themeDir'], 'string'],
  ['PMJUDE_LOG_FILE', ['log', 'file'], 'string'],
  ['NOTION_API_KEY', ['notion', 'apiKey'], 'string'],
  ['SLACK_BOT_TOKEN', ['slack', 'botToken'], 'string'],
  ['SLACK_APP_TOKEN', ['slack', 'appToken'], 'string'],
  ['LINEAR_API_KEY', ['linear', 'apiKey'], 'string'],
  ['LINEAR_TEAM_ID', ['linear', 'teamId'], 'string'],
];

const DEFAULT_CONFIG_FILENAME = 'pm-jude.config.json';

export interface LoadConfigOptions {
  /** 설정 파일 경로 — 미지정이면 env.PMJUDE_CONFIG, 그다음 ./pm-jude.config.json. */
  filePath?: string;
  /** 주입 지점 — 기본 process.env. 테스트가 실제 환경에 기대지 않게 한다. */
  env?: Record<string, string | undefined>;
}

export function loadConfig(options: LoadConfigOptions = {}): PmJudeConfig {
  const env = options.env ?? process.env;
  const filePath = options.filePath ?? env.PMJUDE_CONFIG ?? resolve(DEFAULT_CONFIG_FILENAME);
  const merged = mergeLayers(readConfigFile(filePath), envOverlay(env));
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(' / ');
    throw new ConfigError(`설정이 스키마를 통과하지 못함: ${issues}`);
  }
  return parsed.data;
}

/** 파일 층 — 부재는 정상({}), 깨진 JSON은 사유를 단 거부. */
function readConfigFile(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return {}; // 파일 없음 — 기본값·env만으로 동작한다
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('최상위가 객체가 아니다');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError(
      `설정 파일이 유효한 JSON이 아니다 (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** env 층 — 매핑표에 있는 변수만 설정 경로로 옮기고 타입을 강제한다. */
function envOverlay(env: Record<string, string | undefined>): Record<string, unknown> {
  const overlay: Record<string, Record<string, unknown>> = {};
  for (const [envVar, [group, key], kind] of ENV_MAPPING) {
    const value = env[envVar];
    if (value === undefined || value === '') continue;
    overlay[group] ??= {};
    overlay[group][key] = coerce(envVar, value, kind);
  }
  return overlay;
}

function coerce(envVar: string, value: string, kind: EnvKind): unknown {
  if (kind === 'number') {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new ConfigError(`${envVar}는 숫자여야 한다: "${value}"`);
    }
    return parsed;
  }
  if (kind === 'boolean') {
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    throw new ConfigError(`${envVar}는 1/0 또는 true/false여야 한다: "${value}"`);
  }
  return value;
}

/** 두 단계 깊이의 겹침 — 스키마가 그룹 → 키 구조라 그 이상은 필요 없다. */
function mergeLayers(
  file: Record<string, unknown>,
  env: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...file };
  for (const [group, values] of Object.entries(env)) {
    const base = merged[group];
    merged[group] =
      typeof base === 'object' && base !== null && !Array.isArray(base)
        ? { ...base, ...(values as Record<string, unknown>) }
        : values;
  }
  return merged;
}
