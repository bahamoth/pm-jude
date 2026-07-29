/**
 * 노션 커넥터 (#57, ADR-0013) — 요청자 발화의 노션 URL을 첨부 등급 텍스트로 바꾼다.
 *
 * 페치는 마크다운 엔드포인트 1회다 — 블록 재귀·페이지네이션·블록→markdown 환원은
 * 2026-02 이전 API를 전제한 계획이었고 현행 API에서는 불필요하다. URL 규칙·에러 매핑·
 * 상한의 1차 출처는 docs/research/notion-api.md (developers.notion.com 조사).
 *
 * 반환 markdown은 표준이 아니라 Notion-flavored다(<callout>·<mention-*> 등 XML형 태그
 * 혼재). 정규화 없이 받은 그대로 저장한다 — 원본 불변(ADR-0011 결정 4)이며, 추출물이
 * 라운드마다 재사용되므로 규칙을 나중에 바꾸면 캐시와 신본이 섞인다.
 */

/** 마크다운 엔드포인트가 요구하는 API 버전 — 이 버전만 받는다 (research §1.2). */
const NOTION_VERSION = '2026-03-11';
const BASE_URL = 'https://api.notion.com';
/** 페이지 1건 페치의 시간 상한 — 게이트웨이 봉투 밖, 커넥터 자체 예산 (ADR-0013 결정 3). */
const DEFAULT_TIMEOUT_MS = 30_000;

const NOTION_URL_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)?notion\.(?:com|so|site)\/[^\s<>")\]]+/gi;
/** 버전 무관 32-hex — v4 강제 검사는 현행 노션 ID(v8)를 거부한다 (research §4.2). */
const HEX32 = /[0-9a-f]{32}/i;

/** 요청자 발화에서 노션 링크를 골라낸다 — 등장 순서 유지. */
export function detectNotionUrls(text: string): string[] {
  return text.match(NOTION_URL_PATTERN) ?? [];
}

/** 32-hex를 8-4-4-4-12 대시형으로 — 로그·source_url 대조를 위한 정규형. */
function dashed(hex32: string): string {
  const h = hex32.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type ParsedNotionUrl =
  { kind: 'page'; pageId: string } | { kind: 'database' } | { kind: 'invalid' };

/**
 * URL → 페이지 ID. 우선순위는 공식 SDK 추출기 이식 (research §4.5):
 * ① p=/page_id= 쿼리 ② p= 없이 v=만 있으면 경로 ID는 데이터베이스 ③ 경로의 32-hex.
 */
export function parseNotionUrl(url: string): ParsedNotionUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'invalid' };
  }
  const fromQuery = parsed.searchParams.get('p') ?? parsed.searchParams.get('page_id');
  if (fromQuery && HEX32.test(fromQuery)) {
    return { kind: 'page', pageId: dashed(fromQuery.match(HEX32)![0]) };
  }
  // 뷰 ID가 있는데 페이지 파라미터가 없다 — 경로의 32-hex는 데이터베이스 컨테이너다
  if (parsed.searchParams.has('v')) return { kind: 'database' };
  const fromPath = parsed.pathname.match(HEX32);
  if (fromPath) return { kind: 'page', pageId: dashed(fromPath[0]) };
  return { kind: 'invalid' };
}

export type NotionFetchResult =
  { status: 'ok'; title: string; markdown: string } | { status: 'failed'; error: string };

/** 코어 러너가 의존하는 최소 표면 — 테스트는 이 인터페이스의 가짜를 주입한다. */
export interface NotionPageSource {
  fetchPage(pageId: string): Promise<NotionFetchResult>;
}

export interface NotionConnectorOptions {
  token: string;
  /** 테스트 주입 지점 — 시임이 곧 구현 경계다 (research §5.4). */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class NotionConnector implements NotionPageSource {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: NotionConnectorOptions) {
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchPage(pageId: string): Promise<NotionFetchResult> {
    let markdownRes: Response;
    try {
      markdownRes = await this.request(`/v1/pages/${pageId}/markdown`);
    } catch (error) {
      return {
        status: 'failed',
        error: `노션 페이지를 가져오지 못했다: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!markdownRes.ok) return { status: 'failed', error: failureReason(markdownRes.status) };

    const body = (await markdownRes.json()) as {
      markdown: string;
      truncated?: boolean;
      unknown_block_ids?: string[];
    };
    // 약 2만 블록 초과 또는 접근 차단 블록 — 조용한 절단 금지 (ADR-0014와 같은 정신)
    const markdown = body.truncated
      ? `${body.markdown}\n\n[노션 페이지가 커서 일부 블록(${String(body.unknown_block_ids?.length ?? 0)}건 이상)이 잘렸다]`
      : body.markdown;

    return { status: 'ok', title: await this.titleOf(pageId), markdown };
  }

  /** 제목은 속성 조회에서 — 실패해도 본문 페치를 무르지 않는다 (파일명 폴백). */
  private async titleOf(pageId: string): Promise<string> {
    try {
      const res = await this.request(`/v1/pages/${pageId}`);
      if (!res.ok) return fallbackTitle(pageId);
      const page = (await res.json()) as {
        properties: Record<string, { type: string; title?: Array<{ plain_text: string }> }>;
      };
      const titleProp = Object.values(page.properties).find((p) => p.type === 'title');
      const title = (titleProp?.title ?? []).map((t) => t.plain_text).join('');
      return title.trim() || fallbackTitle(pageId);
    } catch {
      return fallbackTitle(pageId);
    }
  }

  private request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    return this.fetchFn(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        'Notion-Version': NOTION_VERSION,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }
}

function fallbackTitle(pageId: string): string {
  return `notion-${pageId.slice(0, 8)}`;
}

/** 상태 코드 → 사유. 404 하나가 미공유·부존재·타입 불일치를 모두 덮는다 (research §1.4). */
function failureReason(status: number): string {
  if (status === 404) {
    return '노션 페이지를 찾을 수 없다 — 페이지가 존재하면 노션에서 ••• → 연결(Connections)에 통합을 공유해 달라';
  }
  if (status === 403) {
    return '노션 통합에 read content capability가 없다 — 운영자가 통합 설정을 확인해야 한다';
  }
  if (status === 401)
    return '노션 API 토큰이 유효하지 않다 — 운영자가 NOTION_API_KEY를 확인해야 한다';
  if (status === 429) return '노션 API 요청 한도 초과 — 잠시 뒤 다시 시도해 달라';
  return `노션 API 오류 (HTTP ${String(status)})`;
}
