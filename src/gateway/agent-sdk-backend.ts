import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BackendImage, BackendRequest, BackendResponse, LlmBackend } from './backend';

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
          ...(this.options.model ? { model: this.options.model } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success') {
          throw new Error(`Agent SDK 실행 실패: ${message.subtype}`);
        }
        return {
          outputText: message.result,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            costUsd: message.total_cost_usd,
          },
        };
      }
      throw new Error('Agent SDK가 result 메시지 없이 종료됨');
    } finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }
}
