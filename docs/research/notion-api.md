# 리서치 — 노션 API 읽기 경로 (#57)

> **EN** — Primary-source research for the Notion connector (#57): how to turn a pasted Notion URL into attachment-grade text. Headline finding: Notion shipped a first-party markdown endpoint (`GET /v1/pages/{page_id}/markdown`, Feb 2026; opened to internal integrations Mar 2026) that returns a whole page in **one** request, superseding the block-recursion + hand-rolled block→markdown plan recorded in #57 — a ~200-request, ~70-second fetch for a 1,000-block page collapses to 1–2 requests. Read §2 and §7 before implementing. Also load-bearing: `?v=` in a URL means the path ID is a **database**, not a page (§4), so #57's "take only the page ID from a `?v=` link" rule cannot work as written; and `@notionhq/client` has zero runtime dependencies plus built-in 429/`Retry-After` retry, so the dependency-footprint objection to the SDK does not hold (§5).

조사일 2026-07-29. 대상: 노션 URL → 페이지 페치 → 첨부 등급 텍스트 환원(#57). 1차 출처만 사용했다 — `developers.notion.com` 공식 문서, `makenotion/notion-sdk-js` 저장소 소스, npm 레지스트리 메타데이터, 노션 API 체인지로그. 블로그·스택오버플로는 단서 탐색에만 쓰고 모든 주장은 그 사실을 소유한 페이지로 추적했다.

문서 본문의 인용은 `developers.notion.com`의 원문 마크다운(`<url>.md`, 색인 [llms.txt](https://developers.notion.com/llms.txt))에서 가져왔다. 렌더된 HTML과 같은 내용이며 인용의 정확도를 위해 원문을 썼다.

## 결론 — #57 구현에 바꿔야 할 3가지

**① 블록 재귀를 짓지 마라.** `GET /v1/pages/{page_id}/markdown`이 페이지 전체를 1회 요청으로 마크다운 문자열로 돌려준다(§2.1). #57의 「블록 재귀·페이지네이션·블록→markdown 환원」은 2026년 2월 이전 API를 전제한 계획이다. 재귀 경로는 1,000블록 페이지에서 요청 200회·70초가 들고(§6), 마크다운 경로는 1~2회다. 블록 타입별 `rich_text` 환원 코드(§2.2 표)도 전부 불필요해진다.

**② `?v=` 링크는 페이지가 아니다.** #57의 Out of Scope는 「`?v=` 뷰 링크는 페이지 ID만 취한다」로 적혀 있으나, `?v=`는 **뷰 ID**이고 뷰의 부모는 항상 데이터베이스이므로 경로의 32-hex는 데이터베이스 컨테이너 ID다(§4.3). 그 ID로 `GET /v1/pages/{id}`를 부르면 404다. 페이지 ID는 `?v=`가 아니라 `&p=` 파라미터에 실려 온다. 규칙을 「`p=` 우선, 없으면 경로 ID, `?v=`만 있고 `p=`가 없으면 데이터베이스 링크로 판정해 사유를 달아 실패」로 고쳐야 한다.

**③ SDK를 배제할 근거가 없다.** `@notionhq/client` 5.23.2는 **런타임 의존성 0개**이고 전역 `fetch`를 쓰며, 429/`Retry-After` 재시도가 내장돼 있다(§5). 저장소의 의존성 최소 정책과 충돌하지 않는다. 다만 이 커넥터가 쓰는 표면은 엔드포인트 1~2개뿐이므로 plain `fetch`도 성립한다 — 판단은 §5.4.

부수 정정: 현행 최신 API 버전은 **`2026-03-11`**이고 `Notion-Version` 헤더는 필수다(§1.2). 마크다운 엔드포인트는 이 버전만 받는다. `notion-to-md`는 불필요하고 사실상 방치 상태다(§7.2).

## 1. 인증

### 1.1 내부 통합(internal connection) 발급 흐름

노션 문서는 「integration」을 **connection**으로 개칭했다. 내부 커넥션의 정의와 발급 자격:

> An internal connection is scoped to a single Notion workspace. Only members of that workspace can use it.

발급에는 **Workspace Owner** 권한이 필요하다. 절차는 Developer portal → Build → Internal connections → Create a new connection → 이름·워크스페이스 지정 → Configuration 탭에서 토큰(문서 표현: *Installation access token*) 확인이다. 같은 탭에서 capability(read content / update content / insert content / user information)를 설정한다. ([Internal connections](https://developers.notion.com/guides/get-started/internal-connections))

토큰 접두사는 `ntn_`이다. 체인지로그가 전환 시점을 명시한다:

> Starting September 25, 2024, newly generated Public API tokens will automatically use the `ntn_` prefix instead of the `secret_` prefix

([Changelog](https://developers.notion.com/page/changelog), 퀵스타트의 토큰 예시도 `ntn_***` — [Quickstart](https://developers.notion.com/docs/create-a-notion-integration))

### 1.2 요청 헤더

베이스 URL은 `https://api.notion.com`이며 요청·응답 본문은 JSON이다. ([Introduction](https://developers.notion.com/reference/intro))

```
Authorization: Bearer $NOTION_API_KEY
Notion-Version: 2026-03-11
Content-Type: application/json
```

`Notion-Version`은 **필수**다 — 누락 시 400 `missing_version` (*"The request is missing the required `Notion-Version` header."*). ([Status codes](https://developers.notion.com/reference/status-codes))

현행 최신 버전은 `2026-03-11`이다. 버전 고정이 모든 변경을 막아주지는 않는다:

> Additive changes apply to **every** API version at the same time, including older ones: pinning `Notion-Version` does not delay them.

([Versioning](https://developers.notion.com/reference/versioning)) 구 버전 폐기 계획은 없다고 명시돼 있으나(*"We don't currently have any plans to stop supporting older API versions."*), **마크다운 엔드포인트는 `2026-03-11`만 받는다**(§2.1) — 이 커넥터는 `2026-03-11`로 고정한다.

### 1.3 페이지 공유가 선행 조건

토큰만으로는 아무것도 읽지 못한다.

> A newly created connection has no page access by default. If you skip this step, any API request will return an error.

공유 절차:

> Open a Notion page you want the connection to access. Click the ••• menu in the top-right corner of the page. Select Connections, then click + Add connection. Search for your connection and select it. Confirm the connection can access the page and all of its child pages.

([Internal connections](https://developers.notion.com/guides/get-started/internal-connections))

공유는 하위로 상속된다:

> If a connection is added to a page, then the connection can access the page's children. When a connection receives access to a Notion page or database, it can read and write to both that resource and its children.

또한 capability는 사용자 권한을 넘지 못한다:

> A connection's capabilities will never supersede a user's. If a user loses edit access to the page where they have added a connection, that connection will now also only have read access, regardless of the capabilities the connection was created with.

([Connection capabilities](https://developers.notion.com/reference/capabilities))

### 1.4 미공유 페이지의 에러 — 404 `object_not_found`

| 상황 | HTTP | `code` | 문서상 의미 |
|---|---|---|---|
| 미공유·부존재·잘못된 객체 타입 | **404** | `object_not_found` | *"Given the bearer token used, the resource does not exist. This error can also indicate that the resource has not been shared with owner of the bearer token. If the connection name is available, it will be included in the error message."* |
| read content capability 없음 | **403** | `restricted_resource` | *"Given the bearer token used, the client doesn't have permission."* |
| 토큰 무효 | **401** | `unauthorized` | *"The bearer token is not valid."* |
| `Notion-Version` 누락 | **400** | `missing_version` | *"The request is missing the required `Notion-Version` header."* |
| rate limit 초과 | **429** | `rate_limited` | *"This request exceeds the number of requests allowed."* |
| 노션 과부하 | **529** | `service_overload` | *"Notion is temporarily overloaded. Respect the `Retry-After` header."* |

([Status codes](https://developers.notion.com/reference/status-codes))

404의 `message`에 공유 안내가 담긴다 — 문서가 제시하는 실제 형태:

> `"Could not find database with ID: be907abe-510e-4116-a3d1-7ea71018c06f. Make sure the relevant pages and databases are shared with your connection \"My Connection\"."`

엔드포인트별 서술도 같다 — *"Returns a 404 HTTP response if the page doesn't exist, or if the connection doesn't have access to the page."* ([Retrieve a page](https://developers.notion.com/reference/retrieve-a-page))

**#57 시사점.** 404 하나가 「미공유」·「없는 페이지」·「페이지가 아니라 데이터베이스」 셋을 모두 덮는다 — status/code만으로는 구분이 불가능하다. `message` 문자열이 유일한 추가 단서이므로, 실패 사유(P-U3)를 요청자에게 「통합에 페이지를 공유해 달라」로 안내할 때는 404를 그 문구로 매핑하는 것이 최선이다. 403은 별개 원인(capability 미설정)이므로 운영자용 사유로 갈라야 한다.

## 2. 페이지 본문 읽기

경로가 두 개다. 마크다운 엔드포인트(2.1)가 이 커넥터의 정답이고, 블록 재귀(2.2)는 대조군·폴백으로 기록한다.

### 2.1 1차 경로 — `GET /v1/pages/{page_id}/markdown`

2026-02-26 체인지로그:

> Three new endpoints let you create, read, and update page content using enhanced markdown

세 엔드포인트: `POST /v1/pages`(`markdown` 파라미터로 생성), **`GET /v1/pages/:page_id/markdown`(읽기)**, `PATCH /v1/pages/:page_id/markdown`(수정). ([Changelog](https://developers.notion.com/page/changelog), [Working with markdown content](https://developers.notion.com/guides/data-apis/working-with-markdown-content))

내부 통합에서의 사용 가능 여부가 2026-03-02에 열렸다 — 이 커넥터의 전제(§1.1)에 직결된다:

> The endpoint is now available to internal integrations (workspace-level bots), in addition to public integrations

([Changelog](https://developers.notion.com/page/changelog))

응답은 페이지네이션이 없는 단일 객체다:

```json
{
  "object": "page_markdown",
  "id": "page-uuid",
  "markdown": "# Meeting Notes\nDiscussed roadmap priorities.\n## Action items\n- [ ] Draft proposal\n- [ ] Schedule follow-up",
  "truncated": false,
  "unknown_block_ids": []
}
```

문서화된 한계:

- **레코드 상한 약 20,000 블록.** 초과 시 `truncated: true`이고 해당 블록은 `<unknown url="..." alt="..."/>` 태그로 나오며 `unknown_block_ids`(최대 100개)에 ID가 담긴다. 그 ID를 같은 엔드포인트의 `page_id`로 다시 넣어 재페치한다.
- 권고: *"keep pages under a few thousand blocks. Very large pages may require multiple requests to fully retrieve."*
- `<unknown>`으로 떨어지는 타입: bookmark, embed, link preview, breadcrumb, template, `unsupported`.
- 파일계 블록(image/file/video/audio/pdf)의 URL은 *"pre-signed and ready to download. They expire after a short period"* — 만료 기간은 문서에 없다.
- `include_transcript`(boolean, 기본 false) — 회의록 전사 포함 여부.
- read content capability 필요(없으면 403), 페이지 없음·접근 불가는 404.

([Retrieve a page as markdown](https://developers.notion.com/reference/retrieve-page-markdown), [Working with markdown content](https://developers.notion.com/guides/data-apis/working-with-markdown-content))

**출력이 표준 마크다운은 아니다.** 형식 이름은 *enhanced markdown* / Notion-flavored Markdown이며 표준 구문과 XML형 태그가 섞인다. 표준: `#`~`####` 제목, `-`/`1.` 목록(들여쓰기로 자식), `- [ ]`/`- [x]` 할 일, 삼중 백틱 코드(언어 지정), `> ` 인용. 비표준: `<callout icon="emoji" color="...">`, `<details>`+`<summary>`(토글), `<columns>`/`<column>`, `<table fit-page-width header-row>`, `<audio>`/`<video>`/`<file>`/`<pdf src=...>`, `<page>`/`<database>`/`<synced_block>`, `<mention-user>`/`<mention-page>`/`<mention-date>`, `<table_of_contents/>`, 첫 줄 속성 `{color="blue"}`, `:emoji_name:`, `<span underline="true">`·`<br>`, 인용 `[^URL]`, 인라인 수식 `$...$`. ([Enhanced markdown format](https://developers.notion.com/guides/data-apis/enhanced-markdown))

**#57 시사점.** 첨부는 `text/markdown`으로 저장되고 이후 파이프라인은 텍스트만 본다 — XML형 태그가 섞여도 LLM 입력으로서는 성립한다(판단). 다만 `<unknown .../>`와 `<mention-*>`는 의미 없는 URL 잡음이므로 저장 전 정규화 후보다. 정규화를 하든 안 하든 결정은 명시적으로 남겨야 한다 — 추출물이 라운드마다 재사용되므로(`src/extract/types.ts`) 나중에 규칙을 바꾸면 캐시된 텍스트와 새 텍스트가 섞인다.

### 2.2 대조군 — 블록 재귀

마크다운 엔드포인트를 못 쓰는 경우(구 버전 고정, `truncated` 페이지의 부분 재구성)를 위한 기록이다.

**제목·속성.** `GET /v1/pages/{page_id}` — 본문은 오지 않는다:

> Responses contains page **properties**, not page content. To fetch page content, use the [Retrieve block children](/reference/get-block-children) endpoint.

제목은 `properties` 안의 `title` 타입 속성(rich text 배열)에 있다. 참조 상한도 있다:

> The endpoint returns a maximum of 25 page or person references per page property. If a page property includes more than 25 references, then the 26th reference and beyond might be returned as `Untitled`, `Anonymous`, or not be returned at all.

([Retrieve a page](https://developers.notion.com/reference/retrieve-a-page))

**본문.** `GET /v1/blocks/{block_id}/children`. 페이지 ID를 그대로 block ID로 쓴다:

> Pages are a special kind of block, but they have children like many other block types. When retrieving a list of child blocks, you can use the page ID as a block ID.

한 단계만 온다:

> Returns only the first level of children for the specified block.

> If your connection needs a complete representation of a page's (or any block's) content, it should search the results for blocks with `has_children` set to `true`, and recursively call the retrieve block children endpoint.

성능 주의도 문서에 있다:

> Reading large pages may take some time. We recommend using asynchronous operations in your architecture, such as a job queue. You will also need to be mindful of rate limits to appropriately slow down making new requests after the limit is met.

([Working with page content](https://developers.notion.com/guides/data-apis/working-with-page-content), [Retrieve block children](https://developers.notion.com/reference/get-block-children))

**페이지네이션.** `page_size` 기본 **100**, 최대 **100**. `has_more`가 `true`면 `next_cursor`를 같은 엔드포인트의 `start_cursor`로 넘긴다 — *"Treat this as an opaque value."* 응답이 `page_size`보다 적을 수 있다(*"The response may contain fewer than `page_size` of results."*). ([Pagination](https://developers.notion.com/reference/pagination))

**`has_children`** — *"Whether or not the block has children blocks nested within it."* 자식을 가질 수 있는 타입(문서 목록): bulleted_list_item, callout, child_database, child_page, column, heading_1~4(`is_toggleable: true`인 경우), numbered_list_item, paragraph, quote, synced_block, table, template, to_do, toggle, meeting_notes. ([Block](https://developers.notion.com/reference/block))

**텍스트 환원 위치** (모두 [Block](https://developers.notion.com/reference/block)):

| 블록 타입 | 텍스트 위치 | 비고 |
|---|---|---|
| `paragraph` | `paragraph.rich_text[]` | 자식 가능 |
| `heading_1` / `heading_2` / `heading_3` / `heading_4` | `heading_N.rich_text[]` | `is_toggleable: true`면 자식 가능 |
| `bulleted_list_item` / `numbered_list_item` | `<type>.rich_text[]` | 자식 가능 |
| `to_do` | `to_do.rich_text[]` + `to_do.checked` | 자식 가능 |
| `toggle` | `toggle.rich_text[]` | 자식 가능 |
| `quote` | `quote.rich_text[]` | 자식 가능 |
| `callout` | `callout.rich_text[]` (+ `icon`) | 자식 가능 |
| `code` | `code.rich_text[]` + `code.caption[]` + `code.language` | |
| `table` | 없음 — `table_row` 자식 보유 | `has_children: true` 항상 |
| `table_row` | `table_row.cells[][]` (rich text 배열의 배열) | |
| `child_page` | `child_page.title` (**문자열**, rich_text 아님) | 자식 가능 |
| `child_database` | `child_database.title` (**문자열**) | |
| `equation` | `equation.expression` (KaTeX 문자열) | |
| `bookmark` | `bookmark.url` + `bookmark.caption[]` | |
| `divider` / `breadcrumb` / `column_list` | 빈 객체 | `column_list`는 자식 가능 |
| `column` | `column.width_ratio`(0~1, 선택) | 자식 가능 |
| `synced_block` | `synced_block.synced_from` / `.children[]` | 자식 가능 |
| `template` | `template.rich_text[]` | 자식 가능 |
| `meeting_notes` | `meeting_notes.title[]` + 메타 | `2026-03-11`에서 `transcription`이 개칭됨 |
| `image` / `file` / `video` / `pdf` / `audio` | file 객체 — 텍스트 없음 | |
| `embed` / `link_preview` / `table_of_contents` / `unsupported` | 텍스트 없음 | |

**`rich_text` → 문자열.** 모든 rich text 객체에 `plain_text`가 있다 — *"The plain text without annotations."* 타입은 `text` / `mention` / `equation` 셋이고 표시 텍스트는 각각 `text.content` / (전용 필드 없음) / `equation.expression`에 있지만, **세 타입 모두 `plain_text`를 포함한다**. 따라서 환원은 타입 분기 없이 `arr.map(r => r.plain_text).join('')` 한 줄이다. 링크는 `href`에 있다 — *"The URL of any link or Notion mention in this text, if any."* ([Rich text](https://developers.notion.com/reference/rich-text))

## 3. Rate limit·크기 상한

### 3.1 Rate limit

| 축 | 문서 내용 |
|---|---|
| 커넥션당 | *"an average of three requests per second, with some bursts beyond the average allowed"* |
| 워크스페이스당 | 워크스페이스 플랜에 따라 스케일되며 그 워크스페이스의 모든 커넥션이 공유 |

([Request limits](https://developers.notion.com/reference/request-limits)) 워크스페이스 축은 2026-06-16에 추가됐다 — *"The Notion API now applies a rate limit per workspace, in addition to the existing per-connection limit"* ([Changelog](https://developers.notion.com/page/changelog)).

429 처리: `code`는 `rate_limited`, `Retry-After` 헤더는 *"set as an integer number of seconds (in decimal)"*이며 재시도 전에 그 값을 존중해야 한다. HTTP **529** `service_overload`도 같은 방식으로 다룬다. ([Request limits](https://developers.notion.com/reference/request-limits), [Status codes](https://developers.notion.com/reference/status-codes))

### 3.2 크기 상한

페이로드 전체: **최대 1000 블록 요소, 500KB**. 속성값 상한 ([Request limits](https://developers.notion.com/reference/request-limits)):

| 대상 | 상한 |
|---|---|
| rich text `text.content` | 2000자 |
| rich text `text.link.url` | 2000자 |
| rich text `equation.expression` | 1000자 |
| 임의 URL | 2000자 |
| 임의 email | 200자 |
| 임의 전화번호 | 200자 |
| 블록 배열 | 100개 |
| multi-select 옵션 | 100개 |
| relation | 100 페이지 |
| people | 100 사용자 |

문서 주석: 이 상한은 **단일 요청당**이며 속성의 총 용량 제한은 아니다.

**읽기 경로에 걸리는 상한.** 위 표는 쓰기 검증용이 대부분이다. 읽기에서 실제로 걸리는 것은 셋이다 — 페이지네이션 100(§2.2), 마크다운 엔드포인트의 약 20,000 블록·`unknown_block_ids` 100개(§2.1), 페이지 속성의 참조 25개(§2.2). `text.content` 2000자 상한은 **블록 하나가 2000자를 넘으면 rich text 항목이 쪼개져 온다**는 뜻이므로 `join('')` 환원이 필수다(판단 — 상한의 직접 귀결).

## 4. URL → ID

### 4.1 URL 형태

| 형태 | 상태 | 출처 |
|---|---|---|
| `https://app.notion.com/p/{slug}-{32hex}` | **현행** — API가 돌려주는 `Page.url` 값 | [Page](https://developers.notion.com/reference/page) (예: `https://app.notion.com/p/Avocado-d093f1d200464ce78b36e58a3f0d8043`) |
| `https://app.notion.com/p/{32hex}` | 현행(슬러그 없음) | [Database](https://developers.notion.com/reference/database) |
| `https://www.notion.com/{workspace}/{database_id}?v={view_id}` | 현행 데이터베이스 URL | [Working with databases](https://developers.notion.com/guides/data-apis/working-with-databases) |
| `https://www.notion.so/{page-id}` | 레거시 — 계속 동작 | [Changelog](https://developers.notion.com/page/changelog) |
| `https://{subdomain}.notion.site/{slug}-{32hex}` | 현행 — 웹 발행 페이지(`Page.public_url`) | [Page](https://developers.notion.com/reference/page) |
| `https://www.notion.so/{workspace}/{slug}-{32hex}` | 레거시 | SDK 테스트 픽스처 ([id-extraction.test.ts](https://github.com/makenotion/notion-sdk-js/blob/main/test/id-extraction.test.ts)) |

도메인 이전은 2026-07-15 체인지로그가 명시한다:

> As part of Notion's move from `notion.so` to `notion.com`, the links Notion generates for its own records changed in early June 2026: the `url` values returned for pages, databases, and data sources ... now point at the Notion app domain with a page path prefix, `https://app.notion.com/p/{page-id}`, instead of `https://www.notion.so/{page-id}`. Existing `notion.so` links continue to open correctly.

같은 항목이 URL 파싱을 정면으로 경고한다:

> These values are links for people to open in Notion, not stable identifiers: their domain and path format may change again. To reference a record, use its `id` field rather than parsing the URL

([Changelog](https://developers.notion.com/page/changelog))

`/p/`는 *"a page path prefix"*로만 문서화돼 있다 — **객체 타입 신호가 아니다**(§4.3). `notion.so/help/what-is-a-url`은 현재 404다(`notion.com/help/what-is-a-url`으로 301 후 부존재) — URL 형식 문서는 개발자 문서로 이관됐다.

### 4.2 32-hex → 대시 UUID

> Top-level resources are addressable by a UUIDv4 `"id"` property. **You may omit dashes from the ID when making requests to the API**, e.g. when copying the ID from a Notion URL.

([Introduction](https://developers.notion.com/reference/intro)) 데이터베이스 가이드도 같다: *"You may use either the hyphenated or un-hyphenated ID when calling the API."* **대시는 선택이다.** 삽입 규칙은 8-4-4-4-12로 문서화돼 있다:

> The URL ends in a page ID. It should be a 32 character long string. Format this value by inserting hyphens (-) in the following pattern: 8-4-4-4-12 ... Example: `1429989fe8ac4effbc8f57f56486db54` becomes `1429989f-e8ac-4eff-bc8f-57f56486db54`.
>
> While this procedure is helpful to try the API, **you shouldn't ask users to do this for your connection.**

([Working with page content](https://developers.notion.com/guides/data-apis/working-with-page-content))

**UUID 버전 검증을 넣지 마라.** 문서는 `UUIDv4`라고 쓰지만, 실제 현행 ID의 13번째 hex(버전 니블)는 `8`이다 — 공식 문서의 예시 ID(`248104cd-477e-**8**0fd-...`, `255104cd-477e-**8**08c-...`)와 실사용 ID 모두 그렇다. RFC 9562 기준 **UUIDv8**이며, 문서의 「UUIDv4」와 2021년대 예시(`1429989f-e8ac-**4**eff-...`)만 v4다. 따라서 `zod`의 v4 강제 검사나 `/-4[0-9a-f]{3}-[89ab]/` 류 정규식은 **현행 노션 ID를 거부한다**. 버전 무관 검사를 쓴다 — 공식 SDK도 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`로 버전 제약 없이 본다([helpers.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/helpers.ts)). ID 앞부분에 시간 상관 성분이 있으나 UUIDv7 배치와도 다르고 타임스탬프 디코딩은 실패했다 — **불투명 값으로 다뤄야 한다**(관측 사실 + 판단).

### 4.3 `?v=`는 뷰 ID — 경로 ID는 데이터베이스

> Open the database as a full page in Notion. Use the `Share` menu to `Copy link`. ... The URL uses the following format:
> ```
> https://www.notion.com/{workspace_name}/{database_id}?v={view_id}
> ```
> Find the part that corresponds to `{database_id}` in the URL you pasted. ... This value is your **database ID**.

([Working with databases](https://developers.notion.com/guides/data-apis/working-with-databases)) `Retrieve a database`도 같은 규칙을 다른 말로 쓴다 — *"The ID is the 32-character alphanumeric string between the slash following the workspace name (if applicable) and the question mark."* ([Retrieve a database](https://developers.notion.com/reference/retrieve-database))

뷰의 부모는 항상 데이터베이스다([View](https://developers.notion.com/reference/view)). 공식 SDK 소스의 주석도 같은 함정을 지목한다 — *"Prioritizes path IDs over query parameters **to avoid extracting view IDs instead of database IDs**."* ([helpers.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/helpers.ts))

> **판단(강한 근거).** `?v=`가 있으면 경로의 32-hex는 데이터베이스 컨테이너 ID다. 역은 성립하지 않는다 — `?v=`가 없다고 페이지라는 보장은 없다(특정 뷰 없이 열린 데이터베이스, 사이드바에서 복사한 링크).

문서 오류 주의: 위 안내문은 `{database_id}`가 *"36 character long string"*이라고 쓰는데 URL에 실린 것은 대시 없는 **32**자다(`Retrieve a database`는 32로 맞게 씀). 길이 32/36 검사를 그 문장에 맞춰 짜면 안 된다.

### 4.4 실제 예시 해부

`https://app.notion.com/p/some-slug-39766007e77080c6a0bbc2572c136295?v=29466007e77080659824000c94fa5643&source=copy_link`

| 조각 | 판정 | 근거 등급 |
|---|---|---|
| `39766007e77080c6a0bbc2572c136295` | 경로의 레코드 ID. 대시형 **`39766007-e770-80c6-a0bb-c2572c136295`** | 1차 출처(추출 + 8-4-4-4-12) |
| `?v=29466007e77080659824000c94fa5643` | **뷰 ID**(대시형 `29466007-e770-8065-9824-000c94fa5643`) | 1차 출처(§4.3) |
| `source=copy_link` | 문서화되지 않음. 노션 1차 출처(개발자 문서·헬프센터·SDK) 어디에도 없다. ID 추출 전에 버린다 | 판단 |
| `?v=` 존재 → 경로 ID는 데이터베이스? | **그렇다** — 뷰 ID가 있으므로 경로 ID는 데이터베이스 컨테이너 ID. 페이지도, 데이터 소스도 아니다 | 판단(1차 사실 2개의 귀결) |
| `/p/` 접두사 | 타입 신호 아님. 체인지로그가 *"a page path prefix"*로만 정의 — 전체 페이지로 열린 데이터베이스도 이 경로로 도달한다 | 1차 출처 |

**`&p=`가 진짜 페이지 ID를 싣는다.** 공식 SDK의 추출기는 경로 → 쿼리 `p` / `page_id` / `database_id` → 마지막 수단(문서 내 첫 32-hex) 순으로 본다([helpers.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/helpers.ts), 픽스처는 [id-extraction.test.ts](https://github.com/makenotion/notion-sdk-js/blob/main/test/id-extraction.test.ts)). `p` 파라미터가 쿼리 폴백에 들어 있다는 사실이, 데이터베이스 뷰에서 행을 펼쳐 복사한 링크가 `?v={view}&p={page}` 형태임을 뒷받침한다(판단).

SDK 추출기 재사용 시 알아둘 구멍: 경로 매칭 정규식이 32-hex **직전의 `-`를 요구**하므로 슬러그 없는 `/p/{32hex}` 형태는 「문서 내 첫 32-hex」 폴백으로 떨어진다. 이 예시에서는 경로가 쿼리보다 앞이라 우연히 맞지만 규칙으로 성립하지는 않는다. 또 SDK 저장소에는 `app.notion.com` 인식이 전혀 없고, 추출기는 타입 판별을 하지 않는다.

### 4.5 페이지 / 데이터베이스 / 데이터 소스 판별

2025-09-03 버전에서 데이터베이스가 **database(컨테이너) + data_source**로 쪼개졌다:

> Most API operations that used `database_id` now require a `data_source_id`

> **You can't use a database ID with the retrieve data source API, or vice-versa. The two types of IDs are not interchangeable.**

`GET /v1/databases/{id}`는 남아 있으나 용도가 바뀌었다 — *"The Retrieve Database API is now repurposed to return a list of `data_sources`"*. 질의는 `POST /v1/databases/{id}/query` → **`POST /v1/data_sources/{data_source_id}/query`**로 이동했다. ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), [Query a data source](https://developers.notion.com/reference/query-a-data-source))

즉 32-hex 하나만 놓고는 **3지 선다**(page / database / data source)이고 세 ID는 모양이 같으며 서로의 엔드포인트를 받지 않는다. 다만 **URL에는 데이터 소스 ID가 실리지 않는다** — 문서화된 데이터베이스 URL 형식이 `{database_id}?v={view_id}`이므로, 데이터 소스 ID는 `GET /v1/databases/{id}` 응답이나 앱 UI에서만 얻는다.

문서화된 유일한 판별 근거는 성공 응답의 `object` 필드다 — *"Top-level resources have an `"object"` property. This property can be used to determine the type of the resource"* ([Introduction](https://developers.notion.com/reference/intro)). 따라서 실패 기반 판별은 불가능하다: `GET /v1/pages/{database_id}`는 404 `object_not_found`로 떨어지고(판단 — 해당 엔드포인트의 404 스키마가 `object_not_found`/`directory_not_found`만 허용하며 유효한 UUID에 대한 400 경로가 문서에 없다), 이 404는 「미공유」와 구분되지 않는다(§1.4).

**#57 권고 규칙** (페이지만 취급하는 스코프에 맞춘 판단):

1. 쿼리에서 `source=` 등 잡음 제거.
2. `p` / `page_id` 파라미터가 있으면 그 값이 페이지 ID — 최우선.
3. 없고 `?v=`가 있으면 **데이터베이스 링크로 판정**해 「페이지 링크가 필요하다」 사유로 실패(Out of Scope 준수).
4. 둘 다 없으면 경로의 `-{32hex}` 또는 `/p/{32hex}`를 페이지 ID로 취한다.
5. 8-4-4-4-12 대시 삽입은 선택이지만, 로그·`attachment.source_url` 대조를 위해 정규형 하나로 고정하는 편이 낫다.
6. `POST /v1/search`는 ID 조회용이 아니다(제목·공유 범위 기반) — 판별 폴백으로 쓸 수 없다.

## 5. 공식 SDK vs plain fetch

### 5.1 `@notionhq/client` 실측

| 항목 | 값 | 출처 |
|---|---|---|
| 최신 버전 | **5.23.2** (2026-07-15 게시) | [registry](https://registry.npmjs.org/@notionhq/client/latest) |
| 런타임 의존성 | **0개** — `dependencies` 키 자체가 없다 | registry 메타 + 게시 tarball의 `package.json` |
| fetch | 전역 `fetch` 사용 — `this.#fetch = options?.fetch ?? fetch.bind(globalThis)`. node-fetch 번들 없음. `ClientOptions.fetch`로 주입 가능 | [Client.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/Client.ts) |
| `engines.node` | `>=18` (README는 node ≥18, TypeScript ≥5.9 명시) | registry `/latest`, [README](https://github.com/makenotion/notion-sdk-js/blob/main/README.md) |
| 설치 크기 | `unpackedSize` **966,320 B**, 112 파일 | registry `/latest` |
| 타입 | `types: ./build/src/index.d.ts`. **생성된 타입** — `src/api-endpoints.ts` 헤더가 `// Note: This is a generated file. DO NOT EDIT!` | [api-endpoints.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/api-endpoints.ts) |
| 기본 `Notion-Version` | `static readonly defaultNotionVersion = "2025-09-03"` — **최신(`2026-03-11`)이 아니다** | [Client.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/Client.ts) |

### 5.2 429 재시도 — 내장돼 있다

v5.10.0(2026-02-26, *"Add automatic retry support with exponential backoff"*)부터 클라이언트가 직접 재시도한다. 모두 [Client.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/Client.ts) / [constants.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/constants.ts):

- `ClientOptions.retry?: RetryOptions | false`, `RetryOptions = { maxRetries?, initialRetryDelayMs?, maxRetryDelayMs? }`
- `canRetry()` — `rate_limited`·`service_overload`는 **모든 메서드**에서 재시도, `internal_server_error`·`service_unavailable`은 멱등 메서드(`get`·`delete`)만
- `calculateRetryDelay()` — `Retry-After` 헤더가 있으면 그 값 사용(`maxRetryDelayMs`로 상한), 없으면 지터 붙인 지수 백오프
- `parseRetryAfterHeader()` — delta-seconds와 HTTP-date 양쪽 지원
- 기본값: `DEFAULT_MAX_RETRIES = 2`, `DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000`, `DEFAULT_MAX_RETRY_DELAY_MS = 60_000`, `DEFAULT_TIMEOUT_MS = 60_000`

**타임아웃은 재시도되지 않는다.** `RequestTimeoutError`는 `APIResponseError`가 아니라 `canRetry`가 false를 준다. 더불어 `rejectAfterTimeout`은 래퍼 프라미스만 reject하며 **하위 fetch를 중단하지 않는다** — 소스에 `AbortController`가 없다([Client.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/Client.ts), [errors.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/errors.ts)). #56의 「프롬프트별 타임아웃 상한」과 같은 성격의 주의 지점이다.

### 5.3 유용한 헬퍼

[helpers.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/helpers.ts) — `src/index.ts`에서 공개:

```ts
iteratePaginatedAPI(listFn, firstPageArgs): AsyncIterableIterator<Item>
collectPaginatedAPI(listFn, firstPageArgs): Promise<Item[]>
extractNotionId / extractPageId / extractDatabaseId / extractBlockId
isFullBlock / isFullPage / isFullDataSource / ...
```

마크다운 엔드포인트도 이미 래핑돼 있다 — `notion.pages.retrieveMarkdown({ page_id, include_transcript? })`, v5.11.0(2026-02-27)에 추가. ([Client.ts](https://github.com/makenotion/notion-sdk-js/blob/main/src/Client.ts), [v5.11.0 릴리스](https://github.com/makenotion/notion-sdk-js/releases/tag/v5.11.0))

### 5.4 판단 — 이 커넥터에는 plain `fetch`

**의존성 근거로 SDK를 배제할 수는 없다** — 런타임 의존성 0개, 전역 fetch, node ≥18은 저장소 정책(node ≥22, 의존성 7개)과 충돌하지 않는다. 그런데도 plain `fetch`를 권고하는 이유:

- **사용 표면이 엔드포인트 1~2개다.** `GET /v1/pages/{id}/markdown`(+ 폴백 시 `GET /v1/pages/{id}`)이 전부다. 966KB·112파일과 생성된 타입 전체를 끌어올 표면이 아니다.
- **SDK의 기본 버전이 필요한 버전과 다르다.** 기본 `2025-09-03`이므로 어차피 `notionVersion: "2026-03-11"`을 명시해야 한다 — SDK를 써도 버전 인지를 코드에 남겨야 한다.
- **재시도 로직이 커넥터 예산과 겹친다.** #57은 「페이지당 시간 상한·세션당 페이지 수 상한」을 커넥터 자체 예산으로 두기로 했다. SDK 재시도(기본 2회, 최대 60초 대기)는 그 예산 밖에서 시간을 쓴다. `Retry-After` 존중은 헤더 하나 읽는 일이고(§3.1), 예산과 한 곳에 두는 편이 낫다.
- **테스트 심이 이미 fetch 주입이다.** #57의 테스트 결정은 「fetch 함수 주입으로 픽스처 검증」이다. plain fetch면 심이 곧 구현 경계다.

**SDK로 갈 조건**(뒤집힐 지점): 데이터베이스/데이터 소스 질의(F2a), 노션 발행(출력), 파일 업로드가 스코프에 들어오면 표면이 늘어나 생성된 타입의 가치가 의존성 비용을 넘는다. 그때 `@notionhq/client`로 전환한다 — 전환 비용은 `src/connect/notion.ts` 한 파일이다.

**SDK를 안 쓰더라도 가져올 것 2가지**: ① `extractNotionId`의 우선순위(경로 → `p`/`page_id`/`database_id` 쿼리 → 폴백)와 픽스처, ② 버전 무관 UUID 정규식(§4.2).

## 6. 페치 요청 수·소요 시간

가정: 커넥션당 평균 3 req/s(§3.1)를 상한으로 직렬 페치. 워크스페이스 축 상한(플랜별, 커넥션 공유)이 더 낮을 수 있으므로 아래는 **하한**이다.

### 6.1 마크다운 경로

| 페이지 규모 | 요청 수 | rate limit 하한 |
|---|---|---|
| ~20,000 블록 이하 | **1** | ~0.3s |
| `truncated: true` (최악) | 1 + `unknown_block_ids` 최대 100 = **≤101** | ~34s |

실제 벽시계는 rate limit이 아니라 큰 페이지 1건의 응답 지연이 지배한다(측정하지 않음 — 판단).

### 6.2 블록 재귀 경로

요청 수 = 1(`GET /v1/pages/{id}`) + `ceil(최상위 블록수 / 100)` + `has_children` 블록 1개당 1회(자식 100개 초과면 추가).

| 총 블록 | 자식 보유 비율 | 요청 수 | 3 req/s 하한 |
|---|---|---|---|
| 300 | 10% | ~34 | ~11s |
| 300 | 20% | ~64 | ~21s |
| 300 | 33% | ~103 | ~34s |
| 1,000 | 10% | ~110 | ~37s |
| 1,000 | 20% | ~209 | ~70s |
| 1,000 | 33% | ~341 | ~114s |

**중첩이 요청 수를 지배한다.** 표·다단 레이아웃이 특히 비싸다 — `table` 1개는 행 조회 1회를 강제하고, `column_list` 하나에 컬럼 3개면 컬럼당 1회씩 총 4회가 나간다. 콘텐츠는 적어도 요청은 늘어난다.

**결론.** 1,000블록 실무 문서에서 재귀 경로는 요청 ~200회·70초, 마크다운 경로는 1회·1초 미만이다 — **약 200배 차이**. #57이 언급한 사고(노션 PRD 본문 134k자)급 문서라면 재귀 경로는 커넥터 시간 예산 안에서 끝나지 않을 가능성이 크다(판단).

## 7. 마크다운 변환

### 7.1 1차 제공 있음

§2.1이 답이다 — `GET /v1/pages/{page_id}/markdown`이 공식 엔드포인트이고, 형식 사양도 공식 문서로 있다([Enhanced markdown format](https://developers.notion.com/guides/data-apis/enhanced-markdown)). `Accept: text/markdown` 방식이 아니라 JSON 응답의 `markdown` 필드다.

별개로 워크스페이스 단위 export는 관리자 API에 있다(`enqueue-space-export` / `get-space-export-status`) — 엔터프라이즈 워크스페이스 내보내기이고 페이지 단위 마크다운과 무관하다.

### 7.2 `notion-to-md`는 불필요

| 항목 | 값 | 출처 |
|---|---|---|
| 안정 최신 | 3.1.9, **2025-05-12** 게시 (직접 의존: `node-fetch@2`, `markdown-table@^2` → 전이 6패키지) | [registry](https://registry.npmjs.org/notion-to-md) |
| v4 | `4.0.0-alpha.7`(2025-07-20)까지 프리릴리스만. 안정 v4 없음. 런타임 의존에 **`ts-node`** 포함 | registry |
| v4 peer | `@notionhq/client: ^2.0.0` — **v5와 semver 충돌** | registry |
| 유지 상태 | `master` HEAD 2025-07-27(README 수정), 최신 코드 활동은 미게시 브랜치 `v4-alpha-8` 2026-01-27 | [GitHub API](https://api.github.com/repos/souvikinator/notion-to-md/branches) |

1차 제공이 생긴 시점에서 방치된 서드파티와 그 전이 의존성을 들일 근거가 없다(판단).

## 8. #57 착지 메모

| #57 기록 | 이 조사 결과 |
|---|---|
| 「블록 재귀·페이지네이션 ... 블록→markdown 환원은 구현 뒤에 숨는다」 | **불필요** — `GET /v1/pages/{id}/markdown` 1회로 대체(§2.1, §6). 재귀는 폴백으로만 문서화(§2.2) |
| 「`?v=` 뷰 링크는 페이지 ID만 취한다」 | **성립하지 않는다** — `?v=`가 있으면 경로 ID는 데이터베이스다. 페이지 ID는 `&p=`에 있다(§4.3~4.5) |
| 「인증(NOTION_API_KEY 내부 통합 토큰)」 | 유효. 토큰 접두사 `ntn_`, 발급은 Workspace Owner. **페이지 공유가 선행 조건**이고 미공유는 404 `object_not_found`(§1) |
| 「rate limit 대기」 | 평균 3 req/s, 429/529 모두 `Retry-After` 존중(§3.1). 마크다운 경로에서는 사실상 문제되지 않는다 |
| 「미공유·권한·404는 사유를 단 추출 실패로」 | 404(미공유·부존재·타입 불일치)와 403(capability 미설정)을 갈라야 한다 — 404는 요청자용 사유, 403은 운영자용(§1.4) |
| 「text/markdown은 이미 등록된 MIME」 | 유효. 다만 출력은 표준 마크다운이 아니다 — `<callout>`·`<details>`·`<columns>`·`<mention-*>`·`<unknown/>` 등 XML형 태그가 섞인다. 정규화 여부를 명시적으로 결정할 것(§2.1) |
| 「fetch 함수 주입으로 ... 픽스처로 검증」 | plain `fetch` 권고와 정합(§5.4). SDK의 URL 추출 우선순위와 픽스처는 참고 이식(§4.5) |
| — (기록 없음) | `Notion-Version: 2026-03-11` 고정 필요. 마크다운 엔드포인트가 이 버전만 받는다(§1.2) |
| — (기록 없음) | UUID v4 검증을 넣으면 현행 노션 ID가 거부된다 — 버전 무관 검사 필수(§4.2) |
| — (기록 없음) | `truncated: true` / `unknown_block_ids` 처리 경로가 필요하다(약 20,000블록 초과 또는 권한 차단 블록, §2.1) |
