import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import type { UiClassificationOutput } from '../src/prompts/ui-classification-v0';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { FakeIssueConnector, type IssueConnector } from '../src/connect/issue-connector';
import { ThemeRegistry } from '../src/mockup/theme-registry';
import { IntakeRunner, type ChannelPort, type RoundPayload } from '../src/runner/core-runner';
import { SessionStore } from '../src/store/session-store';
import { refinedCompletenessResponse, requirementsResponse } from './slot-fixture';

/**
 * 승인 게이트 심 테스트 (#69, F5·F6·F8) — 상정·4버튼 결정·이슈 생성·종결 회신을
 * 외부 행동(포트 게시·저장 행·신호)으로 검증한다. 하드 제약의 회귀 방어가 핵심이다:
 * 이슈 생성은 승인 분기에만 존재하고, 모든 종결 분기는 회신이 종결을 앞선다.
 */

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}
  requests: BackendRequest[] = [];

  run(request: BackendRequest): Promise<BackendResponse> {
    this.requests.push(request);
    const text = this.responses.shift();
    if (text === undefined) throw new Error('ScriptedBackend: 준비된 응답 없음');
    return Promise.resolve({ outputText: text, usage: { inputTokens: 100, outputTokens: 50 } });
  }
}

class FakePort implements ChannelPort<string> {
  posted: Array<{ address: string; text: string; payload?: RoundPayload }> = [];

  post(address: string, text: string, payload?: RoundPayload): Promise<void> {
    this.posted.push({ address, text, ...(payload ? { payload } : {}) });
    return Promise.resolve();
  }
}

/** 커넥터 호출 계수 — 승인 외 분기에서 0이어야 한다 (하드 제약 회귀 방어). */
class CountingConnector implements IssueConnector {
  readonly kind = 'fake' as const;
  calls: Array<{ title: string; description: string }> = [];
  private readonly inner = new FakeIssueConnector();

  createIssue(input: { title: string; description: string }) {
    this.calls.push(input);
    return this.inner.createIssue(input);
  }
}

const clarificationResponse = JSON.stringify({
  interpretations: ['관리자용 실적 대시보드'],
  questions: [
    {
      question: '이 대시보드는 주로 누가 보게 되나요?',
      target: { type: 'slot', slotKey: 'target-user' },
      exampleOptions: ['영업팀 매니저', '영업사원 본인'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '어떤 문제를 해결하려는 건가요?',
      target: { type: 'slot', slotKey: 'purpose' },
      exampleOptions: ['수작업 집계 제거', '실적 공유'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
    {
      question: '데이터는 어디에서 가져오면 되나요?',
      target: { type: 'slot', slotKey: 'data-source' },
      exampleOptions: ['CRM', '사내 DB'],
      dontKnowPath: { label: '모르겠어요 — 개발팀이 정해 주세요' },
    },
  ],
});

const uiNoResponse = JSON.stringify({
  isUiRequest: false,
  rationale: '데이터 정정 요청 — 화면 변화가 없다',
} satisfies UiClassificationOutput);

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function makeRunner(responses: string[], options?: { issues?: IssueConnector | null }) {
  store = SessionStore.open(':memory:');
  const port = new FakePort();
  const backend = new ScriptedBackend(responses);
  const issues = options?.issues === null ? undefined : (options?.issues ?? new CountingConnector());
  const runner = new IntakeRunner<string>({
    store,
    backend,
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    port,
    teamLanguage: 'ko',
    themes: ThemeRegistry.withBuiltins(),
    ...(issues ? { issues } : {}),
  });
  return { runner, port, backend, store, issues };
}

const intake = {
  address: 'reply-to:thread-1',
  threadKey: 'web:thread-1',
  channel: 'web' as const,
  authorId: 'requester-kim',
  text: '영업 실적 대시보드 하나 만들어 주세요',
};

const answer = { ...intake, text: '영업팀 매니저요. 수작업 집계를 없애고 싶어요.' };
const gateEvent = { ...intake, text: '' };

/** 인테이크 → 답변 → 비 UI 문서 게시 → 게이트 상정까지. */
async function reachGate(extraResponses: string[] = [], options?: { issues?: IssueConnector }) {
  const made = makeRunner(
    [
      clarificationResponse,
      refinedCompletenessResponse,
      requirementsResponse,
      uiNoResponse,
      ...extraResponses,
    ],
    options,
  );
  await made.runner.handleIntake(intake);
  const outcome = await made.runner.handleReply(answer);
  const item = made.store.currentGateItem(outcome!.sessionId);
  if (!item) throw new Error('게이트 항목이 상정되지 않았다');
  return { ...made, outcome, item };
}

function signalTypes(sessions: SessionStore, sessionId: string): string[] {
  return sessions.listSignals(sessionId).map((signal) => signal.type);
}

describe('F5 — 게이트 상정', () => {
  it('비 UI 문서 게시는 게이트 항목을 상정하고 신호를 남긴다', async () => {
    const { outcome, store, item } = await reachGate();

    expect(outcome?.status).toBe('documented');
    expect(item.docVersion).toBe(1);
    expect(item.decision).toBeNull();
    // 픽스처는 data-source 슬롯을 승격시킨다 — 오픈이슈 동반 문서는 조건부 상정이다 (F2c ②)
    expect(item.isConditional).toBe(true);
    expect(signalTypes(store, outcome!.sessionId)).toContain('gate_submitted');
    expect(store.listPendingGateItems().map((row) => row.id)).toContain(item.id);
  });

  it('문서 교정(vN+1)은 재상정이다 — 옛 항목의 결정은 stale로 거부된다', async () => {
    const { runner, store, outcome, item } = await reachGate();

    await runner.correctDocument(gateEvent, {
      mode: 'edit',
      paths: ['problem'],
      replacement: '수정된 문제 문장',
    });

    const current = store.currentGateItem(outcome!.sessionId)!;
    expect(current.docVersion).toBe(2);
    expect(current.decision).toBeNull();
    // 밀려난 v1 항목은 대기 목록에서 빠진다
    expect(store.listPendingGateItems().map((row) => row.id)).not.toContain(item.id);
    // 옛 항목에 대한 결정은 낡은 문서에 대한 결정이다
    await expect(
      runner.decideGate(gateEvent, { gateItemId: item.id, decision: 'backlog' }),
    ).resolves.toBe('stale');
  });
});

describe('F5·F6 — 승인과 이슈 생성', () => {
  it('승인은 커넥터를 정확히 1회 부르고, 회신 후 issue_created로 종결한다', async () => {
    const connector = new CountingConnector();
    const { runner, store, port, outcome, item } = await reachGate([], { issues: connector });
    const postedBefore = port.posted.length;

    const result = await runner.decideGate(gateEvent, {
      gateItemId: item.id,
      decision: 'approve',
      decidedBy: 'dev-lee',
    });

    expect(result).toBe('ok');
    expect(connector.calls).toHaveLength(1);
    // 이슈 본문은 문서의 사영 + provenance 푸터다 (F6)
    expect(connector.calls[0]!.description).toContain('pm-jude:session:');
    expect(connector.calls[0]!.description).toContain('requirements 문서 v1');

    const issues = store.listLinearIssues(outcome!.sessionId);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.identifier).toBe('FAKE-1');
    expect(issues[0]!.connector).toBe('fake');
    expect(issues[0]!.provenanceKey).toContain(`doc:v1`);

    // 회신이 종결을 앞선다 (원칙 5) — 회신에 이슈 식별자가 실린다
    expect(port.posted.length).toBe(postedBefore + 1);
    expect(port.posted.at(-1)?.text).toContain('FAKE-1');
    const session = store.getSession(outcome!.sessionId)!;
    expect(session.status).toBe('closed');
    expect(session.terminalState).toBe('issue_created');
    expect(session.closedAt).not.toBeNull();
    const types = signalTypes(store, outcome!.sessionId);
    expect(types).toContain('gate_decided');
    expect(types).toContain('issue_created');
  });

  it('같은 항목의 재결정은 already_decided다', async () => {
    const { runner, item } = await reachGate();
    await runner.decideGate(gateEvent, { gateItemId: item.id, decision: 'backlog' });

    await expect(
      runner.decideGate(gateEvent, { gateItemId: item.id, decision: 'approve' }),
    ).resolves.toBe('already_decided');
  });

  it('커넥터가 구성되지 않은 승인은 명시적으로 실패한다 — 이슈 없는 「승인 종결」은 없다', async () => {
    const bare = makeRunner(
      [clarificationResponse, refinedCompletenessResponse, requirementsResponse, uiNoResponse],
      { issues: null },
    );
    await bare.runner.handleIntake(intake);
    const outcome = await bare.runner.handleReply(answer);
    const bareItem = bare.store.currentGateItem(outcome!.sessionId)!;

    await expect(
      bare.runner.decideGate(gateEvent, { gateItemId: bareItem.id, decision: 'approve' }),
    ).rejects.toThrow('커넥터');
    // 실패한 승인은 아무것도 남기지 않는다 — 결정도 이슈도 종결도
    expect(bare.store.getGateItem(bareItem.id)?.decision).toBeNull();
    expect(bare.store.listLinearIssues(outcome!.sessionId)).toHaveLength(0);
    expect(bare.store.getSession(outcome!.sessionId)?.status).toBe('documented');
  });
});

describe('F5 — 질문·백로그·거절 (커넥터 무호출)', () => {
  it('질문 결정은 노트를 요청자에게 전달하고 명확화로 복귀하며, 재문서화 시 재상정된다', async () => {
    const connector = new CountingConnector();
    const { runner, store, port, outcome, item } = await reachGate(
      // 질문 복귀 후의 답변이 다시 판정·문서 생성을 돈다
      [refinedCompletenessResponse, requirementsResponse, uiNoResponse],
      { issues: connector },
    );

    const result = await runner.decideGate(gateEvent, {
      gateItemId: item.id,
      decision: 'question',
      note: '기존 CRM 대시보드와 무엇이 다른가요?',
      decidedBy: 'dev-lee',
    });

    expect(result).toBe('ok');
    expect(connector.calls).toHaveLength(0); // 하드 제약 — 이슈 생성은 승인뿐
    expect(store.getSession(outcome!.sessionId)?.status).toBe('clarifying');
    expect(port.posted.at(-1)?.text).toContain('기존 CRM 대시보드와 무엇이 다른가요?');
    // 개발자 질문은 approver 발화로 전사에 남는다 (원칙 7)
    expect(
      store
        .listUtterances(outcome!.sessionId)
        .filter((utterance) => utterance.authorType === 'approver'),
    ).toHaveLength(1);

    // 답변 → 재판정 → 재문서화 → 새 게이트 항목 (v2)
    await runner.handleReply({ ...intake, text: '기존 것은 월간 집계뿐이라 실시간이 필요해요' });
    const current = store.currentGateItem(outcome!.sessionId)!;
    expect(current.docVersion).toBe(2);
    expect(current.decision).toBeNull();
  });

  it('백로그 결정은 회신 후 backlog로 종결한다', async () => {
    const connector = new CountingConnector();
    const { runner, store, port, outcome, item } = await reachGate([], { issues: connector });

    const result = await runner.decideGate(gateEvent, {
      gateItemId: item.id,
      decision: 'backlog',
    });

    expect(result).toBe('ok');
    expect(connector.calls).toHaveLength(0);
    expect(port.posted.at(-1)?.text).toContain('보관함');
    const session = store.getSession(outcome!.sessionId)!;
    expect(session.status).toBe('closed');
    expect(session.terminalState).toBe('backlog');
  });

  it('거절은 통제된 사유가 필수이고, 회신에 사유와 이의 경로가 실린다', async () => {
    const connector = new CountingConnector();
    const { runner, store, port, outcome, item } = await reachGate([], { issues: connector });

    await expect(
      runner.decideGate(gateEvent, {
        gateItemId: item.id,
        decision: 'reject',
        reasonTag: '그냥 싫어서',
      }),
    ).rejects.toThrow('통제된 목록');

    const result = await runner.decideGate(gateEvent, {
      gateItemId: item.id,
      decision: 'reject',
      reasonTag: 'duplicate',
    });

    expect(result).toBe('ok');
    expect(connector.calls).toHaveLength(0);
    const reply = port.posted.at(-1)?.text ?? '';
    expect(reply).toContain('겹쳐요'); // 사유의 요청자 언어 표기
    expect(reply).toContain('재검토'); // 이의 경로 (F5)
    const session = store.getSession(outcome!.sessionId)!;
    expect(session.terminalState).toBe('rejected');
    const decided = store.getGateItem(item.id)!;
    expect(decided.reasonTag).toBe('duplicate');
  });

  it('질문 결정에 노트가 없으면 실패한다 — 빈 질문은 전달할 것이 없다', async () => {
    const { runner, item } = await reachGate();
    await expect(
      runner.decideGate(gateEvent, { gateItemId: item.id, decision: 'question' }),
    ).rejects.toThrow('note');
  });
});

describe('F8 — 종결 후 답변', () => {
  it('게이트 종결(backlog) 후 답변은 안내 회신을 받고 세션은 닫힌 채 남는다', async () => {
    const { runner, store, port, outcome, item } = await reachGate();
    await runner.decideGate(gateEvent, { gateItemId: item.id, decision: 'backlog' });
    const postedBefore = port.posted.length;

    const result = await runner.handleReply({ ...intake, text: '그래도 다시 봐 주세요' });

    expect(result?.status).toBe('closed');
    expect(result?.terminalState).toBe('backlog');
    expect(port.posted.length).toBe(postedBefore + 1);
    expect(signalTypes(store, outcome!.sessionId)).toContain('reply_after_closed');
  });
});
