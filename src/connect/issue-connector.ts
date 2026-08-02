/**
 * 이슈 생성 커넥터 (F6, #69) — 승인 게이트의 승인 경로만 이 인터페이스를 부른다 (하드 제약).
 * Linear 구현은 raw GraphQL + fetch 주입(linear-archive.ts 선례 — @linear/sdk 의존성을 들이지
 * 않는다), 페이크 구현은 자격 증명 없는 로컬에서 루프 전체가 완주되게 하는 결정론적 대역이다.
 */

export interface CreatedIssue {
  issueId: string;
  identifier: string;
  url: string;
}

export interface IssueConnector {
  readonly kind: 'linear' | 'fake';
  createIssue(input: { title: string; description: string }): Promise<CreatedIssue>;
}

const CREATE_MUTATION = `
mutation PmJudeIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}`;

interface CreateResponse {
  data?: {
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string } | null;
    };
  };
  errors?: Array<{ message: string }>;
}

export class LinearIssueConnector implements IssueConnector {
  readonly kind = 'linear' as const;

  constructor(
    private readonly options: {
      apiKey: string;
      teamId: string;
      fetchFn?: typeof fetch;
    },
  ) {}

  async createIssue(input: { title: string; description: string }): Promise<CreatedIssue> {
    const fetchFn = this.options.fetchFn ?? fetch;
    const response = await fetchFn('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Linear 개인 API 키는 Bearer 없이 그대로 넣는다 (linear-archive.ts와 동일)
        Authorization: this.options.apiKey,
      },
      body: JSON.stringify({
        query: CREATE_MUTATION,
        variables: {
          input: {
            teamId: this.options.teamId,
            title: input.title,
            description: input.description,
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Linear API HTTP ${String(response.status)}`);
    }
    const body = (await response.json()) as CreateResponse;
    if (body.errors?.length) {
      throw new Error(`Linear GraphQL 오류: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    const issue = body.data?.issueCreate.issue;
    if (!body.data?.issueCreate.success || !issue) {
      throw new Error('Linear issueCreate가 이슈를 돌려주지 않음');
    }
    return { issueId: issue.id, identifier: issue.identifier, url: issue.url };
  }
}

/**
 * 페이크 커넥터 — LINEAR_API_KEY 부재·페이크 백엔드 모드의 대역. 결정론적 순번 이슈를
 * 돌려주고, 저장 행의 connector='fake'가 실이슈와의 오인을 막는다.
 */
export class FakeIssueConnector implements IssueConnector {
  readonly kind = 'fake' as const;
  private counter = 0;

  createIssue(_input: { title: string; description: string }): Promise<CreatedIssue> {
    this.counter += 1;
    const identifier = `FAKE-${String(this.counter)}`;
    return Promise.resolve({
      issueId: `fake-issue-${String(this.counter)}`,
      identifier,
      url: `https://linear.app/fake/issue/${identifier}`,
    });
  }
}

/** 이슈 본문에 남는 기계 판독 귀속 값 (§10 우회 집계의 전제) — 형식은 코드가 소유한다. */
export function provenanceKeyOf(sessionId: string, docVersion: number): string {
  return `pm-jude:session:${sessionId}:doc:v${String(docVersion)}`;
}

/**
 * requirements 구조체 → 이슈 제목·본문 (F6) — 본문은 문서의 마크다운 사영이고 provenance
 * 푸터를 동반한다. 목업 코드는 여기 실리지 않는다 (하드 제약 — 이미지·URL 형태만).
 */
export function buildIssuePayload(
  content: {
    problem: string;
    users: string[];
    scope: { inScope: string[]; outOfScope: string[] };
    stories: Array<{
      story: string;
      acceptanceCriteria: Array<{ ears: string; gwt: { given: string; when: string; then: string } }>;
    }>;
    dataSources: string[];
    openIssues: Array<{ slotKey: string; question: string; assignee: string | null }>;
  },
  meta: { docVersion: number; provenanceKey: string },
): { title: string; description: string } {
  const firstSentence = content.problem.split(/(?<=[.!?。])\s/)[0] ?? content.problem;
  const title = firstSentence.length > 80 ? `${firstSentence.slice(0, 79)}…` : firstSentence;

  const lines: string[] = [
    `_requirements 문서 v${String(meta.docVersion)} — PM Jude 정제 산출물. 구현 근거는 이 문서다._`,
    '',
    `## 문제`,
    content.problem,
    '',
    '## 사용자',
    ...content.users.map((user) => `- ${user}`),
    '',
    '## 스코프 — 포함',
    ...content.scope.inScope.map((item) => `- ${item}`),
  ];
  if (content.scope.outOfScope.length) {
    lines.push('', '## 스코프 — 제외', ...content.scope.outOfScope.map((item) => `- ${item}`));
  }
  lines.push('', '## 유저스토리·수용기준');
  for (const story of content.stories) {
    lines.push(`- ${story.story}`);
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`  - ${criterion.ears}`);
      lines.push(
        `    - Given ${criterion.gwt.given} / When ${criterion.gwt.when} / Then ${criterion.gwt.then}`,
      );
    }
  }
  lines.push('', '## 데이터 소스');
  if (content.dataSources.length === 0) lines.push('- 미확정 (오픈이슈 참조)');
  else lines.push(...content.dataSources.map((source) => `- ${source}`));
  if (content.openIssues.length) {
    lines.push('', '## 오픈이슈 (요청자가 답할 수 없어 승격됨 — 담당자 확인 필요)');
    for (const issue of content.openIssues) {
      lines.push(`- [${issue.slotKey}] ${issue.question} — 담당: ${issue.assignee ?? '미지정'}`);
    }
  }
  lines.push('', '---', `_${meta.provenanceKey}_`);
  return { title, description: lines.join('\n') };
}
