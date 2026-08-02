import { afterEach, describe, expect, it } from 'vitest';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import type { UiClassificationOutput } from '../src/prompts/ui-classification-v0';
import { buildIssuePayload } from '../src/connect/issue-connector';
import { applyDocumentCorrections, readDocumentPath } from '../src/document/path';
import { createFakeBackend } from '../src/gateway/fake-backend';
import { ThemeRegistry } from '../src/mockup/theme-registry';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { requirementsOutputSchema, type RequirementsOutput } from '../src/prompts/requirements-v0';
import { IntakeRunner, type ChannelPort, type RoundPayload } from '../src/runner/core-runner';
import { SessionStore } from '../src/store/session-store';
import { refinedCompletenessResponse } from './slot-fixture';

/**
 * 규범 다이어그램 심 테스트 (#70, F3 v2.0 — ADR-0018) — 생성·게시·다이어그램 단위 확인·
 * 교정 리셋·이슈 본문 표기를 외부 행동으로 검증한다. 핵심 계약: 확인 없는 재생성 다이어그램은
 * 규범으로 실리지 않는다.
 */

class ScriptedBackend implements LlmBackend {
  constructor(private readonly responses: string[]) {}

  run(_request: BackendRequest): Promise<BackendResponse> {
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

const DIAGRAM = {
  id: 'approval-flow',
  title: '승인 처리 흐름',
  kind: 'flow' as const,
  mermaid: 'flowchart TD\n  submit[제출] --> review[검토]\n  review --> done[완료]',
  sourceAttachmentRef: 'A1',
};

/** 다이어그램을 포함한 requirements 출력 — 첨부 유래 플로우가 문서 안에 규범으로 실린다. */
const requirementsWithDiagramResponse = JSON.stringify({
  problem: '승인 처리가 수작업이라 단계가 누락된다',
  users: ['운영팀 매니저'],
  scope: { inScope: ['승인 흐름 자동화'], outOfScope: [] },
  stories: [
    {
      story: '운영팀 매니저로서, 승인 단계를 빠짐없이 처리하고 싶다',
      acceptanceCriteria: [
        {
          ears: 'When 제출이 접수되면, the system shall 검토 단계로 전달한다',
          gwt: { given: '제출이 존재할 때', when: '접수되면', then: '검토로 전달된다' },
        },
      ],
    },
  ],
  dataSources: [],
  openIssues: [],
  diagrams: [DIAGRAM],
});

let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

function makeRunner(responses: string[]) {
  store = SessionStore.open(':memory:');
  const port = new FakePort();
  const runner = new IntakeRunner<string>({
    store,
    backend: new ScriptedBackend(responses),
    registry: createDefaultRegistry(),
    modelVersion: 'claude-sonnet-5',
    port,
    teamLanguage: 'ko',
    themes: ThemeRegistry.withBuiltins(),
  });
  return { runner, port, store };
}

const intake = {
  address: 'reply-to:thread-1',
  threadKey: 'web:thread-1',
  channel: 'web' as const,
  text: '승인 흐름을 자동화해 주세요',
};

async function reachDocumented() {
  const made = makeRunner([
    clarificationResponse,
    refinedCompletenessResponse,
    requirementsWithDiagramResponse,
    uiNoResponse,
  ]);
  await made.runner.handleIntake(intake);
  const outcome = await made.runner.handleReply({ ...intake, text: '운영팀 매니저요' });
  return { ...made, outcome };
}

describe('F3 v2.0 — 규범 다이어그램의 생성·게시', () => {
  it('다이어그램이 문서 구조체에 영속되고 게시 텍스트에 mermaid 펜스로 실린다', async () => {
    const { store, port, outcome } = await reachDocumented();

    const content = store.latestRequirementsDoc(outcome!.sessionId)?.content as RequirementsOutput;
    expect(content.diagrams).toHaveLength(1);
    expect(content.diagrams[0]).toMatchObject({ id: 'approval-flow', kind: 'flow' });

    const docPost = port.posted.find((entry) => entry.text.includes('*requirements 문서'));
    expect(docPost?.text).toContain('```mermaid');
    expect(docPost?.text).toContain('flowchart TD');
    // 첨부 유래 출처 표시 (F2c 출처 규율과 대칭)
    expect(docPost?.text).toContain('출처: 첨부 A1');
  });

  it('구 버전 출력(diagrams 부재)은 디폴트 빈 배열로 하위 호환된다', () => {
    const legacy = requirementsOutputSchema.parse({
      problem: '문제',
      users: ['사용자'],
      scope: { inScope: ['범위'], outOfScope: [] },
      stories: [
        {
          story: '스토리',
          acceptanceCriteria: [
            { ears: 'When x, the system shall y', gwt: { given: 'g', when: 'w', then: 't' } },
          ],
        },
      ],
      dataSources: [],
    });
    expect(legacy.diagrams).toEqual([]);
    expect(legacy.openIssues).toEqual([]);
  });
});

describe('F3 v2.0 — 다이어그램 단위 확인', () => {
  it('확인이 상태·신호로 남고, 문서 재생성이 확인을 리셋한다', async () => {
    const { runner, store, outcome } = await reachDocumented();
    const sessionId = outcome!.sessionId;

    const result = runner.confirmDiagram({ ...intake, text: '' }, 'approval-flow');
    expect(result?.status).toBe('documented');
    expect(store.listDiagramStates(sessionId)).toMatchObject([
      { diagramId: 'approval-flow', confirmedByRequester: true },
    ]);
    expect(store.listSignals(sessionId).map((s) => s.type)).toContain('diagram_confirmed');

    // 문서에 없는 다이어그램의 확인은 거부된다
    expect(runner.confirmDiagram({ ...intake, text: '' }, 'no-such-diagram')).toBeNull();
  });

  it('다이어그램 교정(diagrams[0].mermaid)은 새 버전을 만들고 확인을 리셋한다', async () => {
    const { runner, store, outcome } = await reachDocumented();
    const sessionId = outcome!.sessionId;
    runner.confirmDiagram({ ...intake, text: '' }, 'approval-flow');

    await runner.correctDocument(
      { ...intake, text: '' },
      {
        mode: 'edit',
        paths: ['diagrams[0].mermaid'],
        replacement: 'flowchart TD\n  submit[제출] --> review[검토]\n  review --> reject[반려]',
      },
    );

    const content = store.latestRequirementsDoc(sessionId)?.content as RequirementsOutput;
    expect(store.latestRequirementsDoc(sessionId)?.version).toBe(2);
    expect(content.diagrams[0]?.mermaid).toContain('reject');
    // 고친 그림은 다시 확인받아야 규범이 된다
    expect(store.listDiagramStates(sessionId)).toMatchObject([
      { diagramId: 'approval-flow', confirmedByRequester: false },
    ]);
  });
});

describe('F6 — 이슈 본문의 다이어그램 지위 표기', () => {
  const content: Parameters<typeof buildIssuePayload>[0] = {
    problem: '승인 처리가 수작업이라 단계가 누락된다',
    users: ['운영팀 매니저'],
    scope: { inScope: ['승인 흐름 자동화'], outOfScope: [] },
    stories: [
      {
        story: '운영팀 매니저로서, 승인 단계를 빠짐없이 처리하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 제출이 접수되면, the system shall 검토 단계로 전달한다',
            gwt: { given: 'g', when: 'w', then: 't' },
          },
        ],
      },
    ],
    dataSources: [],
    openIssues: [],
    diagrams: [DIAGRAM],
  };

  it('확인된 다이어그램은 「요청자 확인됨」, 미확인은 「확인 전 — 규범 아님」으로 실린다', () => {
    const meta = { docVersion: 1, provenanceKey: 'pm-jude:session:s:doc:v1' };

    const unconfirmed = buildIssuePayload(content, meta);
    expect(unconfirmed.description).toContain('확인 전 — 참고용, 규범 아님');

    const confirmed = buildIssuePayload(content, {
      ...meta,
      confirmedDiagramIds: ['approval-flow'],
    });
    expect(confirmed.description).toContain('요청자 확인됨');
    expect(confirmed.description).toContain('```mermaid');
  });
});

describe('문서 주소 — diagrams (#70)', () => {
  const content = requirementsOutputSchema.parse(JSON.parse(requirementsWithDiagramResponse));

  it('title·mermaid만 주소를 갖고, 그 외 필드는 주소 오류다', () => {
    expect(readDocumentPath(content, 'diagrams[0].title')).toBe('승인 처리 흐름');
    expect(readDocumentPath(content, 'diagrams[0].mermaid')).toContain('flowchart');
    expect(() => readDocumentPath(content, 'diagrams[0].id')).toThrow('문서에 없는 주소');
    expect(() => readDocumentPath(content, 'diagrams[1].title')).toThrow('문서에 없는 주소');
  });

  it('mermaid 교정은 다행 텍스트를 보존한다', () => {
    const next = applyDocumentCorrections(content, [
      { path: 'diagrams[0].mermaid', text: 'flowchart LR\n  a --> b\n  b --> c' },
    ]);
    expect(next.diagrams[0]?.mermaid).toBe('flowchart LR\n  a --> b\n  b --> c');
    // 원본 불변 — 이전 버전은 영속된 정본이다
    expect(content.diagrams[0]?.mermaid).toContain('flowchart TD');
  });
});

describe('페이크 백엔드 — 데모 경로의 다이어그램 (#70)', () => {
  it('requirements 고정 출력이 현행 스키마를 통과하고 다이어그램을 포함한다', async () => {
    const registry = createDefaultRegistry();
    const backend = createFakeBackend(registry);
    const requirementsBody = registry.get('requirements@0.4.0').body;

    const response = await backend.run({
      promptBody: requirementsBody,
      input: { conversation: [{}, {}] },
    } as BackendRequest);
    const parsed = requirementsOutputSchema.parse(JSON.parse(response.outputText));
    expect(parsed.diagrams.length).toBeGreaterThan(0);
    expect(parsed.diagrams[0]?.mermaid).toContain('flowchart');
  });
});
