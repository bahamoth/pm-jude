import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionStore } from '../store/session-store';
import { renderTraceHtml } from '../trace/render-html';
import { buildTraceData } from '../trace/trace-data';

/**
 * 로컬 허브 (#36) — pnpm dev에서 이슈 보드·세션 트레이스·저장소 문서를 함께 호스팅한다.
 * 요청자 표면(웹 UI)이 아니라 운영자·개발팀용 열람 표면이다. 루프백 전제.
 * /trace는 정적 파일이 아니라 현재 세션 저장소에서 실시간 렌더링한다.
 */

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// 서빙 화이트리스트 — 저장소 전체가 아니라 문서·보드만 연다
const ALLOWED_DIRS = new Set(['docs', 'issues']);
const ALLOWED_ROOT_FILES = new Set([
  'PRD.md',
  'ARCHITECTURE.md',
  'CONTEXT.md',
  'AGENTS.md',
  'CHANGELOG.md',
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function notFound(res: ServerResponse): void {
  send(res, 404, 'text/html; charset=utf-8', page('없음', '<p>여기엔 그런 문서가 없어요.</p>'));
}

/** 허브·목록·뷰어 공용 셸 — 외부 요청 없는 단일 문서 (light/dark 대응). */
function page(title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${title} · pm-jude</title>
<style>
  :root{color-scheme:light dark}
  body{font:15px/1.6 "Avenir Next","Segoe UI",system-ui,sans-serif;max-width:860px;margin:0 auto;padding:32px 20px 80px}
  a{color:#b4430e}@media(prefers-color-scheme:dark){a{color:#e8703a}}
  nav.crumbs{font-size:12.5px;margin-bottom:20px;opacity:.8}
  article :is(h1,h2,h3){line-height:1.3}
  article pre{padding:12px 14px;overflow-x:auto;border-radius:6px;background:rgba(128,120,100,.12)}
  article code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}
  article :not(pre)>code{background:rgba(128,120,100,.15);padding:1px 5px;border-radius:3px}
  article table{border-collapse:collapse}article :is(td,th){border:1px solid rgba(128,120,100,.4);padding:5px 10px}
  article blockquote{margin:0;padding-left:14px;border-left:3px solid rgba(128,120,100,.4);opacity:.85}
  ul.listing{list-style:none;padding:0}ul.listing li{padding:3px 0}
  .mermaid{background:transparent}
</style>${extraHead}</head><body>
<nav class="crumbs"><a href="/">허브</a> · <a href="/board">이슈 보드</a> · <a href="/trace">트레이스</a></nav>
${body}</body></html>`;
}

function hubPage(): string {
  return page(
    '로컬 허브',
    `<h1>pm-jude 로컬 허브</h1>
<p>요청자 화면은 <a href="http://localhost:3000">웹 UI (localhost:3000)</a> — 아래는 운영·개발 열람 표면.</p>
<h3>살아있는 것</h3>
<ul>
  <li><a href="/board">이슈 보드</a> — 티켓·wayfinder 맵</li>
  <li><a href="/trace">세션 트레이스</a> — 현재 세션 저장소에서 실시간 렌더링</li>
</ul>
<h3>정본 문서</h3>
<ul>
  <li><a href="/repo/PRD.md">PRD</a> · <a href="/repo/docs/prd/">섹션</a></li>
  <li><a href="/repo/ARCHITECTURE.md">ARCHITECTURE</a> · <a href="/repo/docs/architecture.html">브라우저 조감</a></li>
  <li><a href="/repo/CONTEXT.md">CONTEXT (용어집)</a> · <a href="/repo/AGENTS.md">AGENTS</a></li>
  <li><a href="/repo/docs/ux/requester-journey.md">요청자 여정 UX 설계</a></li>
  <li><a href="/repo/docs/adr/">ADR</a> · <a href="/repo/docs/phase0-plan.md">Phase 0 계획</a> · <a href="/repo/docs/data-model.md">데이터 모델</a></li>
  <li><a href="/repo/CHANGELOG.md">CHANGELOG</a> · <a href="/repo/docs/">docs/ 전체</a></li>
</ul>`,
  );
}

/** md 원문을 뷰어 셸에 심는다 — marked(벤더)로 렌더링, mermaid 펜스는 벤더 mermaid로. */
function markdownPage(relPath: string, markdown: string): string {
  const source = JSON.stringify(markdown).replaceAll('</', '<\\/');
  return page(
    relPath,
    `<article id="content"></article>
<script type="application/json" id="md-source">${source}</script>
<script src="/repo/docs/assets/marked.min.js"></script>
<script src="/repo/docs/assets/mermaid.min.js"></script>
<script>
  const raw = JSON.parse(document.getElementById('md-source').textContent);
  const content = document.getElementById('content');
  content.innerHTML = marked.parse(raw);
  content.querySelectorAll('code.language-mermaid').forEach((code) => {
    const pre = document.createElement('pre');
    pre.className = 'mermaid';
    pre.textContent = code.textContent;
    code.closest('pre').replaceWith(pre);
  });
  mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  mermaid.run();
</script>`,
  );
}

function listingPage(relPath: string, absPath: string): string {
  const entries = readdirSync(absPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  const base = relPath.endsWith('/') ? relPath : `${relPath}/`;
  const items = entries
    .map((entry) => {
      const suffix = entry.isDirectory() ? '/' : '';
      return `<li><a href="/repo/${base}${encodeURIComponent(entry.name)}${suffix}">${entry.name}${suffix}</a></li>`;
    })
    .join('\n');
  return page(relPath || 'repo', `<h1>${relPath || 'repo'}</h1><ul class="listing">${items}</ul>`);
}

function serveRepo(res: ServerResponse, rawPath: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(rawPath).replace(/^\/+/, '');
  } catch {
    notFound(res);
    return;
  }
  if (rel.includes('\0')) {
    notFound(res);
    return;
  }
  const abs = resolve(REPO_ROOT, rel);
  // 경로 이탈 차단 + 화이트리스트 — 문서·보드 밖(src·데이터·환경 파일)은 열지 않는다
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + sep)) {
    notFound(res);
    return;
  }
  const top = rel.split('/')[0] ?? '';
  const allowed =
    (rel !== '' && ALLOWED_DIRS.has(top)) || (ALLOWED_ROOT_FILES.has(rel) && !rel.includes('/'));
  if (!allowed || !existsSync(abs)) {
    notFound(res);
    return;
  }
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    send(res, 200, 'text/html; charset=utf-8', listingPage(rel, abs));
    return;
  }
  if (extname(abs) === '.md') {
    send(res, 200, 'text/html; charset=utf-8', markdownPage(rel, readFileSync(abs, 'utf8')));
    return;
  }
  const mime = MIME[extname(abs)] ?? 'application/octet-stream';
  send(res, 200, mime, readFileSync(abs));
}

/** GET 전용. 처리했으면 true — 나머지 라우팅(/api)은 호출부 몫. */
export function handleDevSite(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: SessionStore,
): boolean {
  if (req.method !== 'GET') return false;
  const path = url.pathname;
  if (path === '/') {
    send(res, 200, 'text/html; charset=utf-8', hubPage());
    return true;
  }
  if (path === '/board') {
    serveRepo(res, '/issues/index.html');
    return true;
  }
  if (path === '/trace') {
    const data = buildTraceData(
      store.exportSessions(),
      store.listVersionRegistry(),
      new Date().toISOString(),
    );
    send(res, 200, 'text/html; charset=utf-8', renderTraceHtml(data));
    return true;
  }
  if (path.startsWith('/repo/') || path === '/repo') {
    serveRepo(res, path.slice('/repo'.length));
    return true;
  }
  return false;
}
