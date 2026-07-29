import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  GatewayTimeoutError,
  InvalidStructuredOutputError,
  LlmGateway,
  type UsageLogEntry,
} from '../src/gateway/gateway';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import {
  InvalidPromptRefError,
  PromptRegistry,
  UnknownPromptVersionError,
} from '../src/prompts/registry';

const answerSchema = z.object({ answer: z.string() });

/** 테스트용 백엔드 — 요청을 기록하고 큐에 넣어둔 응답을 차례로 반환한다. */
class FakeBackend implements LlmBackend {
  readonly requests: BackendRequest[] = [];
  private readonly responses: Array<() => Promise<BackendResponse>> = [];

  enqueueText(outputText: string): void {
    this.responses.push(() =>
      Promise.resolve({ outputText, usage: { inputTokens: 10, outputTokens: 5 } }),
    );
  }

  enqueue(fn: () => Promise<BackendResponse>): void {
    this.responses.push(fn);
  }

  run(request: BackendRequest): Promise<BackendResponse> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (!next) throw new Error('FakeBackend: 준비된 응답 없음');
    return next();
  }
}

function makeRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register({
    name: 'clarification',
    semver: '0.1.0',
    body: '표적 질문을 생성하라',
    outputSchema: answerSchema,
    regressionPassed: false,
  });
  return registry;
}

describe('LLM 게이트웨이 complete()', () => {
  it('버전 참조를 해석해 백엔드를 호출하고 스키마 검증된 구조화 출력을 반환한다', async () => {
    const backend = new FakeBackend();
    backend.enqueueText('{"answer":"질문 3건"}');
    const gateway = new LlmGateway({ backend, registry: makeRegistry() });

    const result = await gateway.complete('clarification@0.1.0', { request: '대시보드 만들어줘' });

    expect(result.output).toEqual({ answer: '질문 3건' });
    expect(result.promptRef).toBe('clarification@0.1.0');
    // 하네스 격리(F14): 백엔드에는 레지스트리의 프롬프트 본문과 입력만 전달된다
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]?.promptBody).toBe('표적 질문을 생성하라');
    expect(backend.requests[0]?.input).toEqual({ request: '대시보드 만들어줘' });
  });

  it('버전 참조 없는(미등록·형식 오류) 호출은 백엔드 호출 없이 거부한다', async () => {
    const backend = new FakeBackend();
    const gateway = new LlmGateway({ backend, registry: makeRegistry() });

    await expect(gateway.complete('clarification@9.9.9', {})).rejects.toThrow(
      UnknownPromptVersionError,
    );
    await expect(gateway.complete('그냥-이걸로-해줘', {})).rejects.toThrow(InvalidPromptRefError);
    expect(backend.requests).toHaveLength(0);
  });

  it('파싱·스키마 검증 실패 시 재시도하고, 재시도로 성공하면 결과를 반환한다', async () => {
    const backend = new FakeBackend();
    backend.enqueueText('이건 JSON이 아님');
    backend.enqueueText('{"answer":"재시도 성공"}');
    const gateway = new LlmGateway({ backend, registry: makeRegistry() });

    const result = await gateway.complete('clarification@0.1.0', {});

    expect(result.output).toEqual({ answer: '재시도 성공' });
    expect(backend.requests).toHaveLength(2);
  });

  it('재시도까지 소진하면 InvalidStructuredOutputError로 실패한다', async () => {
    const backend = new FakeBackend();
    backend.enqueueText('{"wrong_key":true}');
    backend.enqueueText('{"wrong_key":true}');
    const gateway = new LlmGateway({ backend, registry: makeRegistry() });

    await expect(gateway.complete('clarification@0.1.0', {})).rejects.toThrow(
      InvalidStructuredOutputError,
    );
    expect(backend.requests).toHaveLength(2);
  });

  it('마크다운 펜스로 감싼 JSON도 파싱한다', async () => {
    const backend = new FakeBackend();
    backend.enqueueText('```json\n{"answer":"펜스 제거"}\n```');
    const gateway = new LlmGateway({ backend, registry: makeRegistry() });

    const result = await gateway.complete('clarification@0.1.0', {});

    expect(result.output).toEqual({ answer: '펜스 제거' });
  });

  it('타임아웃을 넘긴 백엔드 호출은 GatewayTimeoutError로 실패하고 중단 신호를 보낸다', async () => {
    const backend = new FakeBackend();
    backend.enqueue(() => new Promise(() => {})); // 영원히 응답하지 않는 백엔드
    const gateway = new LlmGateway({ backend, registry: makeRegistry(), timeoutMs: 25 });

    await expect(gateway.complete('clarification@0.1.0', {})).rejects.toThrow(GatewayTimeoutError);
    expect(backend.requests[0]?.signal.aborted).toBe(true);
  });

  it('프롬프트 버전이 선언한 timeoutMs가 게이트웨이 전역 상한보다 우선한다', async () => {
    const backend = new FakeBackend();
    backend.enqueue(
      () =>
        new Promise<BackendResponse>((resolve) =>
          setTimeout(
            () =>
              resolve({
                outputText: '{"answer":"장문 완료"}',
                usage: { inputTokens: 1, outputTokens: 1 },
              }),
            50,
          ),
        ),
    );
    const registry = makeRegistry();
    registry.register({
      name: 'requirements',
      semver: '0.1.0',
      body: '요구사항 문서를 생성하라',
      outputSchema: answerSchema,
      regressionPassed: false,
      timeoutMs: 500,
    });
    // 전역 상한 10ms — 버전 선언이 우선하지 않으면 50ms 백엔드는 반드시 실패한다
    const gateway = new LlmGateway({ backend, registry, timeoutMs: 10 });

    await expect(gateway.complete('requirements@0.1.0', {})).resolves.toMatchObject({
      output: { answer: '장문 완료' },
    });
  });

  it('버전 선언 상한을 넘긴 호출은 그 상한을 명시한 GatewayTimeoutError로 실패한다', async () => {
    const backend = new FakeBackend();
    backend.enqueue(() => new Promise(() => {})); // 영원히 응답하지 않는 백엔드
    const registry = makeRegistry();
    registry.register({
      name: 'requirements',
      semver: '0.1.0',
      body: '요구사항 문서를 생성하라',
      outputSchema: answerSchema,
      regressionPassed: false,
      timeoutMs: 25,
    });
    const gateway = new LlmGateway({ backend, registry }); // 전역 기본(120s)만으로는 안 끝날 테스트

    await expect(gateway.complete('requirements@0.1.0', {})).rejects.toThrow('25ms');
    expect(backend.requests[0]?.signal.aborted).toBe(true);
  });

  it('프롬프트 버전이 선언한 effort가 백엔드 요청에 실린다 (#60)', async () => {
    const backend = new FakeBackend();
    backend.enqueueText('{"answer":"완료"}');
    const registry = makeRegistry();
    registry.register({
      name: 'requirements',
      semver: '0.1.0',
      body: '요구사항 문서를 생성하라',
      outputSchema: answerSchema,
      regressionPassed: false,
      effort: 'medium',
    });
    const gateway = new LlmGateway({ backend, registry });

    await gateway.complete('requirements@0.1.0', {});

    expect(backend.requests[0]?.effort).toBe('medium');
  });

  it('동시 실행 상한을 넘는 호출은 앞 호출이 끝날 때까지 백엔드에 도달하지 않는다', async () => {
    const backend = new FakeBackend();
    let releaseFirst!: (response: BackendResponse) => void;
    backend.enqueue(() => new Promise<BackendResponse>((resolve) => (releaseFirst = resolve)));
    backend.enqueueText('{"answer":"두 번째"}');
    const gateway = new LlmGateway({ backend, registry: makeRegistry(), maxConcurrency: 1 });

    const first = gateway.complete('clarification@0.1.0', {});
    const second = gateway.complete('clarification@0.1.0', {});
    await vi.waitFor(() => expect(backend.requests).toHaveLength(1));

    releaseFirst({
      outputText: '{"answer":"첫 번째"}',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await expect(first).resolves.toMatchObject({ output: { answer: '첫 번째' } });
    await expect(second).resolves.toMatchObject({ output: { answer: '두 번째' } });
    expect(backend.requests).toHaveLength(2);
  });

  it('백엔드 호출마다 사용량과 결과를 로깅한다', async () => {
    const backend = new FakeBackend();
    backend.enqueueText('JSON 아님');
    backend.enqueueText('{"answer":"성공"}');
    const entries: UsageLogEntry[] = [];
    const gateway = new LlmGateway({
      backend,
      registry: makeRegistry(),
      usageLogger: { log: (entry) => entries.push(entry) },
    });

    await gateway.complete('clarification@0.1.0', {});

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      promptRef: 'clarification@0.1.0',
      attempt: 1,
      outcome: 'invalid_output',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(entries[1]).toMatchObject({ attempt: 2, outcome: 'ok' });
  });

  it('타임아웃도 사용량 로그에 남는다', async () => {
    const backend = new FakeBackend();
    backend.enqueue(() => new Promise(() => {}));
    const entries: UsageLogEntry[] = [];
    const gateway = new LlmGateway({
      backend,
      registry: makeRegistry(),
      timeoutMs: 25,
      usageLogger: { log: (entry) => entries.push(entry) },
    });

    await expect(gateway.complete('clarification@0.1.0', {})).rejects.toThrow(GatewayTimeoutError);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ attempt: 1, outcome: 'timeout' });
  });
});
