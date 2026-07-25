/**
 * Linear 아카이브 추출 (#9, ADR-0004) — 최근 6~12개월 이슈·코멘트·상태 이력을 GraphQL로 수집한다.
 * fetch를 주입받아 네트워크 없이 테스트한다. API 토큰·대상 팀 선정은 운영자 작업.
 */

export interface ArchiveComment {
  index: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface LinearArchiveIssue {
  identifier: string;
  title: string;
  description: string;
  createdAt: string;
  comments: ArchiveComment[];
  /** completed → (미완료 상태) 전이 횟수 — reopen 신호. */
  reopenCount: number;
  /** 설명(스펙) 편집 이력 횟수. */
  descriptionEditCount: number;
  /** 중첩 페이지 상한으로 코멘트가 잘렸는가 — 침묵 절단 방지용 플래그. */
  commentsTruncated: boolean;
}

const ARCHIVE_QUERY = `
query RetroArchive($filter: IssueFilter, $first: Int!, $after: String) {
  issues(filter: $filter, first: $first, after: $after) {
    nodes {
      identifier
      title
      description
      createdAt
      comments(first: 100) {
        nodes { body createdAt user { displayName } }
        pageInfo { hasNextPage endCursor }
      }
      history(first: 100) {
        nodes { createdAt updatedDescription fromState { type } toState { type } }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface RawPage {
  data?: {
    issues: {
      nodes: Array<{
        identifier: string;
        title: string;
        description: string | null;
        createdAt: string;
        comments: {
          nodes: Array<{
            body: string;
            createdAt: string;
            user: { displayName: string } | null;
          }>;
          pageInfo: { hasNextPage: boolean };
        };
        history: {
          nodes: Array<{
            createdAt: string;
            updatedDescription: boolean | null;
            fromState: { type: string } | null;
            toState: { type: string } | null;
          }>;
          pageInfo: { hasNextPage: boolean };
        };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  errors?: Array<{ message: string }>;
}

function isReopen(entry: { fromState: { type: string } | null; toState: { type: string } | null }) {
  return (
    entry.fromState?.type === 'completed' &&
    entry.toState !== null &&
    entry.toState.type !== 'completed' &&
    entry.toState.type !== 'canceled'
  );
}

export async function fetchLinearArchive(options: {
  apiKey: string;
  teamKey: string;
  /** ISO 날짜 — 이 이후 생성된 이슈만. */
  since: string;
  fetchFn?: typeof fetch;
  pageSize?: number;
}): Promise<LinearArchiveIssue[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const pageSize = options.pageSize ?? 50;
  const issues: LinearArchiveIssue[] = [];
  let after: string | null = null;

  do {
    const response = await fetchFn('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Linear 개인 API 키는 Bearer 없이 그대로 넣는다
        Authorization: options.apiKey,
      },
      body: JSON.stringify({
        query: ARCHIVE_QUERY,
        variables: {
          filter: {
            team: { key: { eq: options.teamKey } },
            createdAt: { gte: options.since },
          },
          first: pageSize,
          after,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Linear API HTTP ${String(response.status)}`);
    }
    const page = (await response.json()) as RawPage;
    if (page.errors?.length) {
      throw new Error(`Linear GraphQL 오류: ${page.errors.map((e) => e.message).join('; ')}`);
    }
    if (!page.data) throw new Error('Linear GraphQL 응답에 data가 없음');

    for (const node of page.data.issues.nodes) {
      issues.push({
        identifier: node.identifier,
        title: node.title,
        description: node.description ?? '',
        createdAt: node.createdAt,
        comments: node.comments.nodes.map((comment, index) => ({
          index,
          author: comment.user?.displayName ?? 'unknown',
          body: comment.body,
          createdAt: comment.createdAt,
        })),
        reopenCount: node.history.nodes.filter(isReopen).length,
        descriptionEditCount: node.history.nodes.filter(
          (entry) => entry.updatedDescription === true,
        ).length,
        commentsTruncated: node.comments.pageInfo.hasNextPage,
      });
    }
    after = page.data.issues.pageInfo.hasNextPage ? page.data.issues.pageInfo.endCursor : null;
  } while (after !== null);

  return issues;
}
