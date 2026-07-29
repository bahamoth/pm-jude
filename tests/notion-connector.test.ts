import { describe, expect, it } from 'vitest';
import { detectNotionUrls, NotionConnector, parseNotionUrl } from '../src/connect/notion';

/**
 * 노션 커넥터 시임 (#57, ADR-0013) — fetch 함수 주입으로 픽스처 검증.
 * URL 규칙의 근거는 docs/research/notion-api.md §4 (공식 SDK 추출 우선순위 이식).
 */

describe('parseNotionUrl — URL → 페이지 ID', () => {
  it('경로의 slug-32hex에서 페이지 ID를 뽑아 8-4-4-4-12 대시형으로 정규화한다', () => {
    expect(
      parseNotionUrl('https://app.notion.com/p/some-slug-39766007e77080c6a0bbc2572c136295'),
    ).toEqual({ kind: 'page', pageId: '39766007-e770-80c6-a0bb-c2572c136295' });
  });

  it('슬러그 없는 /p/{32hex}·레거시 notion.so·notion.site 형태도 받는다', () => {
    expect(parseNotionUrl('https://app.notion.com/p/39766007e77080c6a0bbc2572c136295')).toEqual({
      kind: 'page',
      pageId: '39766007-e770-80c6-a0bb-c2572c136295',
    });
    expect(
      parseNotionUrl('https://www.notion.so/workspace/Avocado-d093f1d200464ce78b36e58a3f0d8043'),
    ).toEqual({ kind: 'page', pageId: 'd093f1d2-0046-4ce7-8b36-e58a3f0d8043' });
    expect(
      parseNotionUrl('https://acme.notion.site/Handbook-d093f1d200464ce78b36e58a3f0d8043'),
    ).toEqual({ kind: 'page', pageId: 'd093f1d2-0046-4ce7-8b36-e58a3f0d8043' });
  });

  it('p= 쿼리 파라미터가 경로 ID보다 우선한다 — 데이터베이스 뷰에서 연 페이지 링크', () => {
    expect(
      parseNotionUrl(
        'https://app.notion.com/p/39766007e77080c6a0bbc2572c136295?v=29466007e77080659824000c94fa5643&p=d093f1d200464ce78b36e58a3f0d8043',
      ),
    ).toEqual({ kind: 'page', pageId: 'd093f1d2-0046-4ce7-8b36-e58a3f0d8043' });
  });

  it('p= 없이 ?v=만 있으면 경로 ID는 데이터베이스다 — 페이지로 오인하지 않는다', () => {
    expect(
      parseNotionUrl(
        'https://app.notion.com/p/live-titles-prd-39766007e77080c6a0bbc2572c136295?v=29466007e77080659824000c94fa5643&source=copy_link',
      ),
    ).toEqual({ kind: 'database' });
  });

  it('32-hex가 없으면 invalid', () => {
    expect(parseNotionUrl('https://app.notion.com/login')).toEqual({ kind: 'invalid' });
  });
});

describe('detectNotionUrls — 발화에서 노션 링크 감지', () => {
  it('노션 도메인의 URL만 골라낸다', () => {
    const text = [
      'Live Title UA Management 기능 만들고 싶다.',
      'https://app.notion.com/p/prd-39766007e77080c6a0bbc2572c136295?source=copy_link',
      '참고: https://example.com/spec 그리고',
      'https://www.notion.so/ws/Managing-38366007e770801b9e00d3a4483310e7',
    ].join('\n');

    expect(detectNotionUrls(text)).toEqual([
      'https://app.notion.com/p/prd-39766007e77080c6a0bbc2572c136295?source=copy_link',
      'https://www.notion.so/ws/Managing-38366007e770801b9e00d3a4483310e7',
    ]);
  });
});

/** 픽스처 fetch — 요청을 기록하고 URL별로 준비된 응답을 돌려준다. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = Object.entries(routes).find(([path]) => url.includes(path));
    if (!route) throw new Error(`픽스처에 없는 URL: ${url}`);
    return Promise.resolve(route[1]());
  };
  return { fetchFn, calls };
}

const PAGE_ID = '39766007-e770-80c6-a0bb-c2572c136295';

function markdownResponse(body: {
  markdown: string;
  truncated?: boolean;
  unknown_block_ids?: string[];
}) {
  return new Response(
    JSON.stringify({
      object: 'page_markdown',
      id: PAGE_ID,
      truncated: false,
      unknown_block_ids: [],
      ...body,
    }),
    { status: 200 },
  );
}

function pageResponse(title: string) {
  return new Response(
    JSON.stringify({
      object: 'page',
      id: PAGE_ID,
      properties: {
        이름: { type: 'title', title: [{ plain_text: title }] },
      },
    }),
    { status: 200 },
  );
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ object: 'error', status, code, message }), { status });
}

describe('NotionConnector.fetchPage', () => {
  it('마크다운 엔드포인트를 2026-03-11 버전·Bearer 토큰으로 부르고 제목과 본문을 돌려준다', async () => {
    const { fetchFn, calls } = fakeFetch({
      '/markdown': () => markdownResponse({ markdown: '# PRD\n본문' }),
      [`/v1/pages/${PAGE_ID}`]: () => pageResponse('Live Titles PRD'),
    });
    const connector = new NotionConnector({ token: 'ntn_test', fetchFn });

    const result = await connector.fetchPage(PAGE_ID);

    expect(result).toEqual({ status: 'ok', title: 'Live Titles PRD', markdown: '# PRD\n본문' });
    const markdownCall = calls.find((c) => c.url.includes('/markdown'));
    expect(markdownCall?.url).toBe(`https://api.notion.com/v1/pages/${PAGE_ID}/markdown`);
    expect(markdownCall?.headers['Notion-Version']).toBe('2026-03-11');
    expect(markdownCall?.headers.Authorization).toBe('Bearer ntn_test');
  });

  it('truncated 응답은 본문 끝에 명시 마커를 단다 — 조용한 절단 금지', async () => {
    const { fetchFn } = fakeFetch({
      '/markdown': () =>
        markdownResponse({ markdown: '# 본문', truncated: true, unknown_block_ids: ['b1'] }),
      [`/v1/pages/${PAGE_ID}`]: () => pageResponse('큰 문서'),
    });
    const connector = new NotionConnector({ token: 'ntn_test', fetchFn });

    const result = await connector.fetchPage(PAGE_ID);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.markdown).toContain('잘렸다');
  });

  it('404는 「통합에 페이지를 공유해 달라」 사유의 실패다 — 미공유·부존재를 덮는 유일한 신호', async () => {
    const { fetchFn } = fakeFetch({
      '/markdown': () => errorResponse(404, 'object_not_found', 'Could not find page'),
    });
    const connector = new NotionConnector({ token: 'ntn_test', fetchFn });

    const result = await connector.fetchPage(PAGE_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error).toContain('공유');
  });

  it('403은 통합 capability 문제로 구분된다 — 운영자용 사유', async () => {
    const { fetchFn } = fakeFetch({
      '/markdown': () => errorResponse(403, 'restricted_resource', 'no permission'),
    });
    const connector = new NotionConnector({ token: 'ntn_test', fetchFn });

    const result = await connector.fetchPage(PAGE_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error).toContain('capability');
  });

  it('제목 조회가 실패해도 본문이 있으면 성공한다 — 파일명은 페이지 ID 폴백', async () => {
    const { fetchFn } = fakeFetch({
      '/markdown': () => markdownResponse({ markdown: '# 본문' }),
      [`/v1/pages/${PAGE_ID}`]: () => errorResponse(404, 'object_not_found', 'gone'),
    });
    const connector = new NotionConnector({ token: 'ntn_test', fetchFn });

    const result = await connector.fetchPage(PAGE_ID);

    expect(result).toEqual({ status: 'ok', title: 'notion-39766007', markdown: '# 본문' });
  });
});
