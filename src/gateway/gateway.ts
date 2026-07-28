import type { BackendImage, BackendResponse, BackendUsage, LlmBackend } from './backend';
import type { PromptRegistry } from '../prompts/registry';

/** 백엔드 호출 1회의 비용/사용량 기록 (F14 운영 규약). */
export interface UsageLogEntry {
  promptRef: string;
  attempt: number;
  outcome: 'ok' | 'invalid_output' | 'timeout';
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
  /** 백엔드 호출 1회의 상한(ms). 기본 120초. */
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
    options: { images?: readonly BackendImage[] } = {},
  ): Promise<CompletionResult<T>> {
    const version = this.options.registry.get(promptRef); // 버전 참조 검증은 상한 대기보다 먼저
    await this.acquire();
    try {
      const attempts = (this.options.maxParseRetries ?? 1) + 1;
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const started = Date.now();
        let response: BackendResponse;
        try {
          response = await this.runWithTimeout(version.body, input, options.images);
        } catch (error) {
          if (error instanceof GatewayTimeoutError) {
            this.log({ promptRef, attempt, outcome: 'timeout', durationMs: Date.now() - started });
          }
          throw error;
        }
        const durationMs = Date.now() - started;
        try {
          const parsed: unknown = JSON.parse(stripFences(response.outputText));
          const output = version.outputSchema.parse(parsed) as T;
          this.log({ promptRef, attempt, outcome: 'ok', usage: response.usage, durationMs });
          return { output, promptRef };
        } catch (error) {
          this.log({
            promptRef,
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
    promptBody: string,
    input: unknown,
    images?: readonly BackendImage[],
  ): Promise<BackendResponse> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    return new Promise<BackendResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new GatewayTimeoutError(`백엔드 호출이 ${timeoutMs}ms 상한을 초과함`));
      }, timeoutMs);
      this.options.backend
        .run({
          promptBody,
          input,
          ...(images && images.length > 0 ? { images } : {}),
          signal: controller.signal,
        })
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }
}
