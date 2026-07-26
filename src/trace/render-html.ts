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
  :root{
    --paper:#f5f2ec; --ink:#211d18; --ink-soft:#6b6357; --hairline:#d9d2c4;
    --card:#fdfbf7; --card-edge:#e4ddd0; --accent:#b4430e;
    --ok:#0e7268; --warn:#976a08;
    --shadow:0 1px 2px rgba(33,29,24,.06),0 8px 24px rgba(33,29,24,.07);
  }
  @media (prefers-color-scheme: dark){
    :root{
      --paper:#161310; --ink:#e9e2d4; --ink-soft:#968d7d; --hairline:#332d25;
      --card:#1f1b16; --card-edge:#383127; --accent:#e8703a;
      --ok:#3aa89a; --warn:#d1a12e;
      --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{color-scheme:light dark;word-break:keep-all;overflow-wrap:break-word}
  body{font:14px/1.55 "Avenir Next","Avenir","Segoe UI",system-ui,sans-serif;background:var(--paper);color:var(--ink)}
  .mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
  header{border-top:3px solid var(--ink);border-bottom:1px solid var(--hairline);padding:18px 28px;
    display:flex;flex-wrap:wrap;gap:6px 24px;align-items:baseline}
  .wordmark{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:22px;font-weight:600}
  .wordmark em{font-style:italic;color:var(--accent)}
  .gen{margin-left:auto;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:var(--ink-soft)}
  main{padding:22px 28px 56px;max-width:1100px}
  #summary{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
  .stat{background:var(--card);border:1px solid var(--card-edge);box-shadow:var(--shadow);padding:10px 14px;min-width:110px}
  .stat .k{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:.12em;
    text-transform:uppercase;color:var(--ink-soft);margin-bottom:2px}
  .stat .v{font-size:19px;font-weight:600}
  .stat .sub{font-size:11px;color:var(--ink-soft)}
  details.session{background:var(--card);border:1px solid var(--card-edge);box-shadow:var(--shadow);margin-bottom:10px}
  details.session>summary{list-style:none;cursor:pointer;padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}
  details.session>summary::-webkit-details-marker{display:none}
  details.session>summary:hover{outline:1px solid var(--accent)}
  .sid{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px;font-weight:600}
  .badge{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10.5px;letter-spacing:.05em;
    padding:2px 8px;border-radius:2px;background:var(--paper);border:1px solid var(--hairline);color:var(--ink-soft)}
  .badge.status{border-color:var(--accent);color:var(--accent)}
  .badge.terminal{border-color:var(--ink-soft);color:var(--ink)}
  .badge.filled{border-color:var(--ok);color:var(--ok)}
  .badge.promoted{border-color:var(--warn);color:var(--warn)}
  .meta{margin-left:auto;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:var(--ink-soft)}
  .body{border-top:1px dashed var(--hairline);padding:14px 16px;display:grid;gap:16px}
  .sect{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10.5px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px}
  th,td{text-align:left;padding:4px 10px 4px 0;border-bottom:1px dashed var(--hairline);vertical-align:top}
  th{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--ink-soft);font-weight:500}
  .utt{display:grid;grid-template-columns:max-content max-content 1fr;gap:4px 10px;font-size:12.5px}
  .utt .who{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:var(--accent)}
  .utt .when{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:var(--ink-soft)}
  .utt .txt{white-space:pre-wrap}
  .empty{color:var(--ink-soft);font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px;padding:30px 0}
  .dataerr{background:var(--card);border:1px solid var(--accent);padding:16px 20px;margin:16px 0;
    font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap}
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
  stat('신호', dist(s.signalTypeCounts));

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
          '<span class="who">' + esc(u.seq + ' ' + u.authorType) + '</span>' +
          '<span class="when">' + esc(u.createdAt.slice(11, 19)) + '</span>' +
          '<span class="txt">' + esc(u.originalText) + '</span>').join('') +
      '</div></div>' +
      '<div><div class="sect">슬롯 상태</div><table><tr><th>slot</th><th>state</th><th>value</th><th>확인</th><th>오픈이슈 담당</th></tr>' +
        (sess.slotStates.map((sl) =>
          '<tr><td class="mono">' + esc(sl.slotKey) + '</td>' +
          '<td><span class="badge ' + esc(sl.state) + '">' + esc(sl.state) + '</span></td>' +
          '<td>' + (sl.value == null ? '—' : esc(JSON.stringify(sl.value))) + '</td>' +
          '<td>' + (sl.confirmedByRequester ? '✓' : '—') + '</td>' +
          '<td>' + esc(sl.openIssueAssignee ?? '—') + '</td></tr>').join('') || '<tr><td colspan="5">—</td></tr>') +
      '</table></div>' +
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
