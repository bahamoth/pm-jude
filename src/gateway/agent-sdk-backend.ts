import { query } from '@anthropic-ai/claude-agent-sdk';
import type { BackendRequest, BackendResponse, LlmBackend } from './backend';

export interface AgentSdkBackendOptions {
  model?: string;
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
        prompt: JSON.stringify(request.input),
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
