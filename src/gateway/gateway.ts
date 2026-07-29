import type { BackendImage, BackendResponse, BackendUsage, LlmBackend } from './backend';
import type { PromptRegistry, PromptVersion } from '../prompts/registry';

/** 백엔드 호출 1회의 비용/사용량 기록 (F14 운영 규약). */
export interface UsageLogEntry {
  promptRef: string;
  /** 이 호출이 귀속되는 세션 (#63). 세션 밖 호출(첨부 추출 등)은 없다. */
  sessionId?: string;
  attempt: number;
  outcome: 'ok' | 'invalid_output' | 'timeout' | 'blocked';
  usage?: BackendUsage;
  durationMs: number;
}

export interface UsageLogger {
  log(entry: UsageLogEntry): void;
}

export interface GatewayOptions {
  backend: LlmBackend;
  registry: PromptRegistry;
  usageLogger?: UsageLogger;
  /** 파싱·스키마 검증 실패 시 재시도 횟수. 기본 1회(총 2회 시도). */
  maxParseRetries?: number;
  /** 백엔드 호출 1회의 기본 상한(ms). 기본 120초. 프롬프트 버전이 자체 timeoutMs를 선언하면 그쪽이 우선한다 (#56). */
  timeoutMs?: number;
  /** 동시에 진행되는 complete() 상한. 기본 2. */
  maxConcurrency?: number;
}

export interface CompletionResult<T = unknown> {
  output: T;
  promptRef: string;
}

/** 재시도를 소진할 때까지 구조화 출력이 스키마를 통과하지 못했다. */
export class InvalidStructuredOutputError extends Error {}

/** 백엔드 호출이 타임아웃 상한을 초과했다. */
export class GatewayTimeoutError extends Error {}

/**
 * 백엔드가 응답 대신 차단 안내를 돌려줬다 (#65) — 사용량 한도, 정책 거부 등.
 *
 * 프롬프트·스키마와 무관하므로 **재시도하지 않는다**. 이 구분이 없으면 한도 안내가
 * JSON 파싱에 실패해 invalid_output으로 로깅되고, 로그를 읽는 쪽은 프롬프트 결함으로
 * 오진한다 — 실제로 그렇게 오진한 적이 있다(2026-07-29).
 */
export class BackendBlockedError extends Error {}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONCURRENCY = 2;

/** ```json 펜스에 감싸인 응답에서 JSON 본문만 벗겨낸다. */
function stripFences(text: string): string {
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(text.trim());
  return match?.[1] ?? text;
}

/**
 * LLM 게이트웨이 — 표준 인터페이스 `complete(promptVersion, input) → structuredOutput`.
 * 얇은 프로바이더 추상화 + 폭주 방지 상한 (PRD §7, F14).
 */
export class LlmGateway {
  constructor(private readonly options: GatewayOptions) {}

  private active = 0;
  private readonly waiters: Array<() => void> = [];

  /**
   * options.images는 첨부 추출 호출 전용이다 (ADR-0011 결정 3) — 파이프라인 호출 4종은 쓰지 않는다.
   * 호출자는 원본이 백엔드에 어떤 형태로 실리는지 모른 채 「이 이미지를 읽어 달라」고만 말한다.
   */
  async complete<T = unknown>(
    promptRef: string,
    input: unknown,
    options: { images?: readonly BackendImage[]; sessionId?: string } = {},
  ): Promise<CompletionResult<T>> {
    const attribution = options.sessionId ? { sessionId: options.sessionId } : {};
    const version = this.options.registry.get(promptRef); // 버전 참조 검증은 상한 대기보다 먼저
    await this.acquire();
    try {
      const attempts = (this.options.maxParseRetries ?? 1) + 1;
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const started = Date.now();
        let response: BackendResponse;
        try {
          response = await this.runWithTimeout(version, input, options.images);
        } catch (error) {
          if (error instanceof GatewayTimeoutError) {
            this.log({
              promptRef,
              ...attribution,
              attempt,
              outcome: 'timeout',
              durationMs: Date.now() - started,
            });
          } else if (error instanceof BackendBlockedError) {
            // 재시도하지 않는다 — 한도는 다시 물어도 같은 답이고, 로그가 프롬프트 결함으로 읽히면 안 된다
            this.log({
              promptRef,
              ...attribution,
              attempt,
              outcome: 'blocked',
              durationMs: Date.now() - started,
            });
          }
          throw error;
        }
        const durationMs = Date.now() - started;
        try {
          const parsed: unknown = JSON.parse(stripFences(response.outputText));
          const output = version.outputSchema.parse(parsed) as T;
          this.log({
            promptRef,
            ...attribution,
            attempt,
            outcome: 'ok',
            usage: response.usage,
            durationMs,
          });
          return { output, promptRef };
        } catch (error) {
          this.log({
            promptRef,
            ...attribution,
            attempt,
            outcome: 'invalid_output',
            usage: response.usage,
            durationMs,
          });
          lastError = error;
        }
      }
      throw new InvalidStructuredOutputError(
        `구조화 출력이 ${attempts}회 시도에도 ${promptRef}의 스키마를 통과하지 못함: ${String(lastError)}`,
      );
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    const max = this.options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    while (this.active >= max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }

  private log(entry: UsageLogEntry): void {
    this.options.usageLogger?.log(entry);
  }

  private runWithTimeout(
    version: PromptVersion,
    input: unknown,
    images?: readonly BackendImage[],
  ): Promise<BackendResponse> {
    // 버전 선언 상한이 전역 기본보다 우선한다 (#56) — 장문 생성만 넓은 봉투를 갖는다
    const timeoutMs = version.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    return new Promise<BackendResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new GatewayTimeoutError(`백엔드 호출이 ${timeoutMs}ms 상한을 초과함`));
      }, timeoutMs);
      this.options.backend
        .run({
          promptBody: version.body,
          input,
          ...(images && images.length > 0 ? { images } : {}),
          ...(version.effort ? { effort: version.effort } : {}),
          signal: controller.signal,
        })
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }
}
