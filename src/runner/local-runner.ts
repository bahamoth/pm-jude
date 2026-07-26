import { randomUUID } from 'node:crypto';
import type { LlmBackend } from '../gateway/backend';
import type { UsageLogger } from '../gateway/gateway';
import type { ClarificationOutput } from '../prompts/clarification-v0';
import type { PromptRegistry } from '../prompts/registry';
import type { SessionStore } from '../store/session-store';
import {
  detectRequesterLanguage,
  IntakeRunner,
  type ClarificationRoundPayload,
} from './core-runner';

// 공유 심의 정의는 코어 러너로 옮겨졌다 (#16 — 순환 임포트 방지). 기존 참조 호환용 재수출.
export { ensureVersionAxes, TEMP_REQUIRED_SLOTS } from './core-runner';

export interface RunnerDeps {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  usageLogger?: UsageLogger;
}

export interface IntakeInput {
  request: string;
  requesterLanguage: string;
  channel: 'web' | 'slack';
}

export interface ClarificationRunResult {
  sessionId: string;
  interpretations: string[];
  questions: ClarificationOutput['questions'];
}

/**
 * 인테이크 1회 실행 — 코어 러너의 CLI 채널 어댑터 (#16, ADR-0007).
 * 포트는 명확화 라운드의 구조화 페이로드를 수집해 되돌려주는 수집기다 (웹 어댑터와 동일 패턴).
 * 세션 생성 → 원문 기록 → 접수 확인 → 명확화 질문 생성·게시가 전부 저장소에 버전 귀속으로
 * 영속된다 — 게시한 질문도 전사에 남는다 (원칙 7).
 */
export async function runClarificationSession(
  deps: RunnerDeps,
  input: IntakeInput,
): Promise<ClarificationRunResult> {
  let captured: ClarificationRoundPayload | undefined;
  const runner = new IntakeRunner<null>({
    ...deps,
    port: {
      post: (_address, _text, payload) => {
        if (payload?.kind === 'clarification_questions') captured = payload;
        return Promise.resolve();
      },
    },
  });

  // 템플릿 회신이 ko·en 2종이라(F2d 초안) 그 외 --lang 값은 발화 문자 감지에 맡긴다.
  const language =
    input.requesterLanguage === 'ko' || input.requesterLanguage === 'en'
      ? input.requesterLanguage
      : detectRequesterLanguage(input.request);

  const { sessionId } = await runner.handleIntake({
    address: null,
    threadKey: `cli:${randomUUID()}`,
    channel: input.channel,
    text: input.request,
    language,
  });
  if (!captured) throw new Error('명확화 질문 페이로드가 게시되지 않았다');

  return {
    sessionId,
    interpretations: captured.interpretations,
    questions: captured.questions,
  };
}
