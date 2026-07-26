import type { LlmBackend } from '../gateway/backend';
import type { UsageLogger } from '../gateway/gateway';
import type { PromptRegistry } from '../prompts/registry';
import type { SessionStore } from '../store/session-store';
import { IntakeRunner, type IntakeEvent } from './core-runner';

export interface SlackPostedMessage {
  channel: string;
  threadTs: string;
  text: string;
}

/** 코어가 아는 Slack의 전부 — Bolt 앱은 이 포트의 얇은 어댑터다 (채널 어댑터 원칙). */
export interface SlackPort {
  postMessage(input: SlackPostedMessage): Promise<void>;
}

export interface SlackThreadEvent {
  channel: string;
  threadTs: string;
  userId: string;
  text: string;
}

export interface SlackRunnerDeps {
  store: SessionStore;
  backend: LlmBackend;
  registry: PromptRegistry;
  modelVersion: string;
  slack: SlackPort;
  usageLogger?: UsageLogger;
  /** 팀 표준 문서 언어 (F2d). 기본 ko. */
  teamLanguage?: string;
  /** 명확화 왕복 상한 — 수치는 PoC 중 확정 (PRD §12). 기본 3. */
  maxRounds?: number;
}

type SlackAddress = { channel: string; threadTs: string };

function toIntakeEvent(event: SlackThreadEvent): IntakeEvent<SlackAddress> {
  return {
    address: { channel: event.channel, threadTs: event.threadTs },
    threadKey: `slack:${event.channel}:${event.threadTs}`,
    channel: 'slack',
    authorId: event.userId,
    text: event.text,
  };
}

/**
 * Slack PoC 러너 (#8) — 코어 러너의 얇은 채널 어댑터 (#16, ADR-0007).
 * Slack 이벤트를 코어 이벤트로, 회신 주소를 SlackPort 호출로 매핑하는 배선만 갖는다.
 * 파이프라인 로직(명확화 루프·2층 판정·승격/보류 분기·문서 조립)은 코어 러너 몫이다.
 */
export class SlackIntakeRunner {
  private readonly core: IntakeRunner<SlackAddress>;

  constructor(deps: SlackRunnerDeps) {
    const { slack, ...coreDeps } = deps;
    this.core = new IntakeRunner<SlackAddress>({
      ...coreDeps,
      port: {
        post: (address, text) =>
          slack.postMessage({ channel: address.channel, threadTs: address.threadTs, text }),
      },
    });
  }

  async handleMention(event: SlackThreadEvent): Promise<void> {
    await this.core.handleIntake(toIntakeEvent(event));
  }

  async handleThreadReply(event: SlackThreadEvent): Promise<void> {
    await this.core.handleReply(toIntakeEvent(event));
  }
}
