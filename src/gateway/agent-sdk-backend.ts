import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BackendImage, BackendRequest, BackendResponse, LlmBackend } from './backend';
import { BackendBlockedError } from './gateway';

/** 결과 메시지에서 판정에 쓰는 부분만 (#65) — SDK 전체 타입에 의존하지 않는다. */
export interface ResultMessageShape {
  subtype: string;
  is_error?: boolean;
  api_error_status?: number | null;
  result: string;
}

export type ResultVerdict =
  | { kind: 'ok'; outputText: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed'; reason: string };

/**
 * SDK 결과 판정 (#65) — subtype만 보면 안 된다.
 *
 * 사용량 한도 안내는 `subtype: 'success'`에 `is_error: true`로 실려 온다. 이를 정상 출력으로
 * 흘려보내면 게이트웨이가 JSON 파싱에 실패해 스키마 위반으로 오진한다 — 로그에는 "구조화
 * 출력이 스키마를 통과하지 못함"만 남고 실제 원인(계정 한도)은 어디에도 없다.
 */
export function classifyResultMessage(message: ResultMessageShape): ResultVerdict {
  if (message.subtype !== 'success') {
    return { kind: 'failed', reason: `Agent SDK 실행 실패: ${message.subtype}` };
  }
  if (message.is_error) {
    const status = message.api_error_status;
    const prefix = status == null ? '' : `HTTP ${String(status)} — `;
    return { kind: 'blocked', reason: `${prefix}${message.result}`.slice(0, 500) };
  }
  return { kind: 'ok', outputText: message.result };
}

export interface AgentSdkBackendOptions {
  model?: string;
}

/**
 * 이미지가 실린 요청의 프롬프트 — 스트리밍 입력으로 content 블록을 구성한다 (ADR-0011).
 * 이미지 없는 호출은 문자열 경로를 그대로 쓴다: 첨부 추출 하나 때문에 파이프라인 4종의
 * 전달 방식이 바뀌면 Exit 시 교체 범위가 늘어난다.
 */
async function* imagePrompt(
  input: unknown,
  images: readonly BackendImage[],
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        ...images.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: image.base64,
          },
        })),
        { type: 'text' as const, text: JSON.stringify(input) },
      ],
    },
  };
}

/**
 * Phase 0 한정 게이트웨이 백엔드 — Claude Agent SDK 헤드리스 하네스 (F14, ADR-0005).
 * 얇은 어댑터로 유지한다. Exit 시 직접 API 구현체로 교체되는 유일한 지점.
 *
 * 안전 규약(F14): `tools: []`로 파일시스템·셸 도구를 전부 비활성화하고,
 * 사용자 입력은 셸 인자가 아니라 SDK 프롬프트 파라미터로 전달한다.
 * 세션 컨텍스트는 게이트웨이 호출자가 저장소에서 조립해 input으로 주입한다(무상태 호출).
 */
export class AgentSdkBackend implements LlmBackend {
  constructor(private readonly options: AgentSdkBackendOptions = {}) {}

  async run(request: BackendRequest): Promise<BackendResponse> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (request.signal.aborted) {
      controller.abort();
    } else {
      request.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const stream = query({
        prompt:
          request.images && request.images.length > 0
            ? imagePrompt(request.input, request.images)
            : JSON.stringify(request.input),
        options: {
          systemPrompt: request.promptBody,
          tools: [],
          allowedTools: [],
          maxTurns: 1,
          abortController: controller,
          // 생성 진행을 로그로 볼 수 있게 스트림 이벤트를 켠다 (#60) — 긴 호출의 관측 가능성
          includePartialMessages: true,
          ...(request.effort ? { effort: request.effort } : {}),
          ...(this.options.model ? { model: this.options.model } : {}),
        },
      });

      // 진행 로그 — 콘솔 티(#55)를 타고 data/logs/*.log에 남는다. 15초에 1줄로 소음 억제.
      const started = Date.now();
      let textChars = 0;
      let eventCount = 0;
      let lastProgressAt = started;

      for await (const message of stream) {
        if (message.type === 'stream_event') {
          const event = message.event as {
            type: string;
            delta?: { type?: string; text?: string; thinking?: string };
          };
          eventCount += 1;
          if (event.type === 'content_block_delta') {
            textChars += event.delta?.text?.length ?? 0;
          }
          if (Date.now() - lastProgressAt >= 15_000) {
            lastProgressAt = Date.now();
            const seconds = Math.round((Date.now() - started) / 1000);
            // 추론(thinking)은 스트림에 실리지 않아 셀 수 없다 — 생사 신호는 이벤트 수신 수다
            console.error(
              `[backend] 생성 진행 ${String(seconds)}s — 본문 ${String(textChars)}자 · 스트림 이벤트 ${String(eventCount)}건`,
            );
          }
          continue;
        }
        // 조용한 API 재시도가 긴 호출의 숨은 원인이 되지 않게 드러낸다
        if (message.type === 'system' && message.subtype === 'api_retry') {
          console.error(
            `[backend] API 재시도 ${String(message.attempt)}/${String(message.max_retries)} — ${String(message.retry_delay_ms)}ms 대기 (HTTP ${String(message.error_status ?? '?')})`,
          );
          continue;
        }
        // 한도 안내는 전용 이벤트로도 온다 — 결과를 기다리기 전에 사유를 남긴다 (#65)
        if (message.type === 'rate_limit_event') {
          const info = message.rate_limit_info;
          if (info.status === 'rejected') {
            const resets = info.resetsAt
              ? ` — ${new Date(info.resetsAt * 1000).toISOString()} 해제`
              : '';
            console.error(`[backend] 사용량 한도 도달, 호출이 거부됐다${resets} (#65)`);
          }
          continue;
        }
        if (message.type !== 'result') continue;
        const verdict = classifyResultMessage(message as unknown as ResultMessageShape);
        if (verdict.kind === 'blocked') throw new BackendBlockedError(verdict.reason);
        if (verdict.kind === 'failed') throw new Error(verdict.reason);
        // 판정이 ok면 subtype은 success다 — usage 접근을 위한 좁히기
        const success = message as Extract<typeof message, { subtype: 'success' }>;
        return {
          outputText: verdict.outputText,
          usage: {
            inputTokens: success.usage.input_tokens,
            outputTokens: success.usage.output_tokens,
            costUsd: success.total_cost_usd,
          },
        };
      }
      throw new Error('Agent SDK가 result 메시지 없이 종료됨');
    } finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }
}
