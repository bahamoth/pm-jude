import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/gateway/fake-backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { IntakeRunner, type ChannelPort } from '../src/runner/core-runner';
import { SessionStore } from '../src/store/session-store';

/**
 * 가짜 백엔드 (#22, 데모·UI 검증 전용) — 출력이 게이트웨이 스키마 검증을 실제로 통과해
 * 파이프라인이 시나리오대로 종결까지 관통하는지 지킨다. 스키마가 바뀌면 여기가 먼저 깨진다.
 */

class CollectingPort implements ChannelPort<null> {
  texts: string[] = [];

  post(_address: null, text: string): Promise<void> {
    this.texts.push(text);
    return Promise.resolve();
  }
}

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

describe('가짜 백엔드 시나리오', () => {
  it('인테이크 → 1차 답변(미정제) → 2차 답변(정제)으로 documented까지 관통된다', async () => {
    store = SessionStore.open(':memory:');
    const registry = createDefaultRegistry();
    const port = new CollectingPort();
    const runner = new IntakeRunner<null>({
      store,
      backend: createFakeBackend(registry),
      registry,
      modelVersion: 'fake-backend',
      port,
    });
    const event = {
      address: null,
      threadKey: 'web:fake-demo',
      channel: 'web' as const,
      text: '영업 실적 대시보드 하나 만들어 주세요',
    };

    await runner.handleIntake(event);
    const first = await runner.handleReply({ ...event, text: '영업팀 매니저가 봅니다' });
    expect(first?.status).toBe('clarifying'); // 1차 답변까지는 미정제 — 다음 라운드 유도

    const second = await runner.handleReply({
      ...event,
      text: '수작업 집계를 없애고 싶어요. 데이터는 모르겠어요 — 개발팀이 정해 주세요.',
    });
    expect(second?.status).toBe('documented');
    expect(port.texts.at(-1)).toContain('requirements 문서 v1');
  });
});
