import type { TraceData } from './trace-data';

// 트레이스 뷰어 HTML 생성 — issues/index.html과 동일 관례:
// JSON data island(#trace-data)가 데이터 소스, 나머지 셸은 렌더러.
// 생성 파일은 자급자족(외부 의존 없음)이라 file://로 바로 연다.

export function renderTraceHtml(data: TraceData): string {
  // "</script>" 조기 종료 방지 — 발화 원문에 어떤 텍스트가 와도 island가 깨지지 않는다.
  const island = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>pm-jude · Session Trace</title>
<style>
  /* shadcn neutral 토큰 — 정본: web-ui/app/globals.css (#37). prefers-color-scheme으로 다크 분기. */
  :root{
    --background:oklch(1 0 0); --foreground:oklch(0.145 0 0);
    --card:oklch(1 0 0); --card-foreground:oklch(0.145 0 0);
    --primary:oklch(0.205 0 0); --primary-foreground:oklch(0.985 0 0);
    --secondary:oklch(0.97 0 0); --secondary-foreground:oklch(0.205 0 0);
    --muted:oklch(0.97 0 0); --muted-foreground:oklch(0.556 0 0);
    --destructive:oklch(0.577 0.245 27.325);
    --border:oklch(0.922 0 0); --ring:oklch(0.708 0 0);
    --radius:0.625rem;
    --shadow-xs:0 1px 2px 0 rgb(0 0 0/.05);
    --font-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Apple SD Gothic Neo",sans-serif;
    --font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --ok:#059669; --warn:#d97706;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --background:oklch(0.145 0 0); --foreground:oklch(0.985 0 0);
      --card:oklch(0.205 0 0); --card-foreground:oklch(0.985 0 0);
      --primary:oklch(0.922 0 0); --primary-foreground:oklch(0.205 0 0);
      --secondary:oklch(0.269 0 0); --secondary-foreground:oklch(0.985 0 0);
      --muted:oklch(0.269 0 0); --muted-foreground:oklch(0.708 0 0);
      --destructive:oklch(0.704 0.191 22.216);
      --border:oklch(1 0 0/10%); --ring:oklch(0.556 0 0);
      --ok:#34d399; --warn:#fbbf24;
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{color-scheme:light dark;word-break:keep-all;overflow-wrap:break-word}
  body{font:14px/1.55 var(--font-sans);background:var(--background);color:var(--foreground);-webkit-font-smoothing:antialiased}
  .mono{font-family:var(--font-mono)}
  header{border-bottom:1px solid var(--border);padding:16px 24px;
    display:flex;flex-wrap:wrap;gap:6px 24px;align-items:center}
  .wordmark{font-size:16px;font-weight:600;letter-spacing:-.01em}
  .wordmark em{font-style:normal;font-weight:400;color:var(--muted-foreground)}
  .gen{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--muted-foreground)}
  main{padding:20px 24px 56px;max-width:1100px}
  #summary{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
    box-shadow:var(--shadow-xs);padding:12px 16px;min-width:120px}
  .stat .k{font-size:11px;font-weight:500;color:var(--muted-foreground);margin-bottom:2px}
  .stat .v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
  .stat .sub{font-size:11px;color:var(--muted-foreground)}
  details.session{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
    box-shadow:var(--shadow-xs);margin-bottom:8px;overflow:hidden}
  details.session>summary{list-style:none;cursor:pointer;padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
  details.session>summary::-webkit-details-marker{display:none}
  details.session>summary:hover{background:color-mix(in oklab,var(--muted) 50%,transparent)}
  .sid{font-family:var(--font-mono);font-size:12px;font-weight:600}
  .badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:9999px;
    font-size:11px;font-weight:500;border:1px solid transparent;
    background:var(--secondary);color:var(--secondary-foreground)}
  .badge.status{background:var(--primary);color:var(--primary-foreground)}
  .badge.terminal{background:transparent;border-color:var(--border);color:var(--foreground)}
  .badge.filled{background:color-mix(in oklab,var(--ok) 12%,transparent);color:var(--ok)}
  .badge.promoted{background:color-mix(in oklab,var(--warn) 15%,transparent);color:var(--warn)}
  .meta{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--muted-foreground)}
  .body{border-top:1px solid var(--border);padding:14px 16px;display:grid;gap:16px}
  .sect{font-size:11px;font-weight:500;color:var(--muted-foreground);margin-bottom:6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px}
  th,td{text-align:left;padding:5px 10px 5px 0;border-bottom:1px solid var(--border);vertical-align:top}
  th{font-size:11px;color:var(--muted-foreground);font-weight:500}
  .utt{display:grid;grid-template-columns:max-content max-content 1fr;gap:4px 10px;font-size:12.5px}
  .utt .who{font-family:var(--font-mono);font-size:11px;font-weight:500;color:var(--foreground)}
  .utt .when{font-family:var(--font-mono);font-size:11px;color:var(--muted-foreground)}
  .utt .txt{white-space:pre-wrap}
  .empty{color:var(--muted-foreground);font-size:12.5px;padding:30px 0}
  .dataerr{border:1px solid color-mix(in oklab,var(--destructive) 40%,transparent);
    background:color-mix(in oklab,var(--destructive) 8%,transparent);color:var(--destructive);
    border-radius:var(--radius);padding:16px 20px;margin:16px 0;
    font-family:var(--font-mono);font-size:12px;white-space:pre-wrap}
</style>
</head>
<body>
<header>
  <div class="wordmark">pm-jude <em>· session trace</em></div>
  <div class="gen">generated ${escapeHtml(data.generatedAt)} · 데이터: #trace-data</div>
</header>
<main>
  <div id="summary"></div>
  <div id="sessions"></div>
</main>

<!-- 이 파일은 pnpm trace가 생성한다 — 직접 편집하지 말 것. 데이터 소스는 #trace-data island. -->
<script type="application/json" id="trace-data">
${island}
</script>
<script>
'use strict';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
let DATA;
try {
  DATA = JSON.parse(document.getElementById('trace-data').textContent);
} catch (e) {
  document.body.insertAdjacentHTML('beforeend',
    '<div class="dataerr">#trace-data JSON 파스 실패\\n' + esc(e.message) + '</div>');
  throw e;
}

const stat = (k, v, sub) =>
  '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' +
  (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
const dist = (counts) => Object.entries(counts).map(([k, n]) => k + ' ' + n).join(' · ') || '—';

const s = DATA.summary;
document.getElementById('summary').innerHTML =
  stat('세션', s.sessionCount, dist(s.channelCounts)) +
  stat('상태 분포', dist(s.statusCounts), s.avgRoundCount == null ? '' : '평균 왕복 ' + s.avgRoundCount) +
  stat('종결', dist(s.terminalCounts)) +
  stat('슬롯', 'filled ' + s.slotStateCounts.filled + ' · unfilled ' + s.slotStateCounts.unfilled +
    ' · promoted ' + s.slotStateCounts.promoted) +
  stat('신호', dist(s.signalTypeCounts)) +
  stat('첨부', s.attachmentCounts.total === 0 ? '—' :
    'ok ' + s.attachmentCounts.ok + ' · failed ' + s.attachmentCounts.failed +
    ' · pending ' + s.attachmentCounts.pending, '총 ' + s.attachmentCounts.total + '건') +
  stat('문서', s.documentCount === 0 ? '—' : s.documentCount + '건', '영속된 버전 수 (#53)');

const root = document.getElementById('sessions');
if (!DATA.sessions.length) {
  root.innerHTML = '<div class="empty">기록된 세션 없음 — pnpm intake로 세션을 만든 뒤 pnpm trace를 다시 실행.</div>';
}
for (const sess of DATA.sessions) {
  const el = document.createElement('details');
  el.className = 'session';
  el.innerHTML =
    '<summary>' +
      '<span class="sid">' + esc(sess.id.slice(0, 8)) + '</span>' +
      '<span class="badge status">' + esc(sess.status) + '</span>' +
      (sess.terminalState ? '<span class="badge terminal">종결: ' + esc(sess.terminalState) + '</span>' : '') +
      '<span class="badge">' + esc(sess.originChannel) + '</span>' +
      '<span class="badge">왕복 ' + sess.roundCount + '</span>' +
      (sess.isUiRequest == null ? '' : '<span class="badge">' + (sess.isUiRequest ? 'UI 요청' : '비 UI') + '</span>') +
      '<span class="meta">' + esc(sess.createdAt) + '</span>' +
    '</summary>' +
    '<div class="body">' +
      '<div><div class="sect">발화 타임라인 (원문 전사)</div><div class="utt">' +
        sess.utterances.map((u) =>
          '<span class="who">' + esc(u.seq + ' ' + u.authorType +
            (u.condensedChars == null ? '' : ' · 압축 ' + u.condensedChars + '자')) + '</span>' +
          '<span class="when">' + esc(u.createdAt.slice(11, 19)) + '</span>' +
          '<span class="txt">' + esc(u.originalText) + '</span>').join('') +
      '</div></div>' +
      (sess.attachments.length
        ? '<div><div class="sect">첨부 자료 (F1-Attach)</div><table><tr><th>발화</th><th>mime</th><th>bytes</th><th>추출</th><th>추출기</th><th>압축·출처</th><th>내용·사유</th></tr>' +
          sess.attachments.map((at) =>
            '<tr><td class="mono">' + (at.utteranceSeq == null ? '—' : at.utteranceSeq) + '</td>' +
            '<td class="mono">' + esc(at.mime) + '</td>' +
            '<td class="mono">' + at.bytes + '</td>' +
            '<td><span class="badge ' + (at.extractionStatus === 'ok' ? 'filled' : at.extractionStatus === 'failed' ? 'unfilled' : '') + '">' + esc(at.extractionStatus) + '</span></td>' +
            '<td class="mono">' + esc(at.extractorVersion ?? '—') + '</td>' +
            // 압축본 길이(#58 ADR-0014)와 페치 출처(#57 ADR-0013) — 없으면 — 표기
            '<td class="mono">' + esc([
              at.condensedChars == null ? null : '압축 ' + at.condensedChars + '자',
              at.sourceUrl,
            ].filter(Boolean).join(' · ') || '—') + '</td>' +
            '<td>' + esc(at.extractionError ?? (at.extractedText ?? '—').slice(0, 200)) + '</td></tr>').join('') +
          '</table></div>'
        : '') +
      '<div><div class="sect">슬롯 상태</div><table><tr><th>slot</th><th>state</th><th>value</th><th>확인</th><th>근거</th><th>오픈이슈 담당</th></tr>' +
        (sess.slotStates.map((sl) =>
          '<tr><td class="mono">' + esc(sl.slotKey) + '</td>' +
          '<td><span class="badge ' + esc(sl.state) + '">' + esc(sl.state) + '</span></td>' +
          '<td>' + (sl.value == null ? '—' : esc(JSON.stringify(sl.value))) + '</td>' +
          '<td>' + (sl.confirmedByRequester ? '✓' : '—') + '</td>' +
          '<td>' + (sl.evidenceAttachmentId ? '첨부' : '대화') + '</td>' +
          '<td>' + esc(sl.openIssueAssignee ?? '—') + '</td></tr>').join('') || '<tr><td colspan="6">—</td></tr>') +
      '</table></div>' +
      (sess.documents.length
        ? '<div><div class="sect">requirements 문서 (#53 — 정본 구조체)</div><table><tr><th>vN</th><th>생성</th><th>content</th></tr>' +
          sess.documents.map((doc) =>
            '<tr><td class="mono">v' + doc.version + '</td>' +
            '<td class="mono">' + esc(doc.createdAt) + '</td>' +
            '<td class="mono">' + esc(JSON.stringify(doc.content)).slice(0, 400) + '</td></tr>').join('') +
          '</table></div>'
        : '') +
      (sess.mockups.length
        ? '<div><div class="sect">목업 반복 (F4 #54 — HTML 원문은 trace 밖)</div><table><tr><th>vN</th><th>문서 vN</th><th>수렴</th><th>테마</th><th>크기</th><th>요약</th></tr>' +
          sess.mockups.map((mk) =>
            '<tr><td class="mono">v' + mk.version + '</td>' +
            '<td class="mono">v' + mk.docVersion + '</td>' +
            '<td><span class="badge ' + (mk.convergence === 'approved' ? 'filled' : mk.convergence === 'escalated' ? 'unfilled' : '') + '">' + esc(mk.convergence) + '</span></td>' +
            '<td class="mono">' + esc(mk.themeDelegated ? '개발팀 위임' : (mk.selectedTheme ?? '—')) + '</td>' +
            '<td class="mono">' + mk.htmlBytes + 'B</td>' +
            '<td>' + esc(mk.summary ?? '—') + '</td></tr>').join('') +
          '</table>' +
          (sess.mockupAnnotations.length
            ? '<table><tr><th>판</th><th>요소</th><th>어노테이션</th><th>시각</th></tr>' +
              sess.mockupAnnotations.map((an) =>
                '<tr><td class="mono">' + (an.mockupVersion == null ? '—' : 'v' + an.mockupVersion) + '</td>' +
                '<td class="mono">' + esc(an.elementRef ?? '—') + '</td>' +
                '<td>' + esc(an.text) + '</td>' +
                '<td class="mono">' + esc(an.createdAt.slice(11, 19)) + '</td></tr>').join('') +
              '</table>'
            : '') +
          '</div>'
        : '') +
      '<div><div class="sect">신호 (F11)</div><table><tr><th>type</th><th>payload</th><th>occurred</th></tr>' +
        (sess.signals.map((sg) =>
          '<tr><td class="mono">' + esc(sg.type) + '</td>' +
          '<td class="mono">' + (sg.payload == null ? '—' : esc(JSON.stringify(sg.payload))) + '</td>' +
          '<td class="mono">' + esc(sg.occurredAt) + '</td></tr>').join('') || '<tr><td colspan="3">—</td></tr>') +
      '</table></div>' +
      '<div><div class="sect">버전 귀속 5축</div><table>' +
        '<tr><th>prompt</th><td class="mono">' + esc(sess.versions.prompt) + '</td></tr>' +
        '<tr><th>model</th><td class="mono">' + esc(sess.versions.model) + '</td></tr>' +
        '<tr><th>threshold</th><td class="mono">' + esc(sess.versions.threshold) + '</td></tr>' +
        '<tr><th>slot schema</th><td class="mono">' + esc(sess.versions.slotSchema) + '</td></tr>' +
      '</table></div>' +
      (sess.requesters.length ?
        '<div><div class="sect">요청자</div><table><tr><th>role</th><th>구독</th><th>언어</th><th>시간대</th></tr>' +
        sess.requesters.map((r) =>
          '<tr><td>' + esc(r.role) + '</td><td>' + (r.subscribed ? '✓' : '—') + '</td>' +
          '<td class="mono">' + esc(r.preferredLanguage) + '</td><td class="mono">' + esc(r.timezone) + '</td></tr>').join('') +
        '</table></div>' : '') +
    '</div>';
  root.appendChild(el);
}
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
