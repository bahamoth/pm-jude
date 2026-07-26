/**
 * 웹 채팅 페이지 (#16) — 의존성 없는 단일 HTML. 간이 식별(이름·언어)로 SSO·매직 링크를
 * 대체하고(ADR-0007), sessionId를 localStorage에 남겨 브라우저를 닫아도 이어간다 (US-8).
 * 전사는 서버(세션 저장소)가 진실 원천이고 이 페이지는 그것을 렌더링만 한다 (원칙 7).
 */
export const WEB_PAGE_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>pm-jude · 요청 인테이크</title>
<style>
  :root{--paper:#f5f2ec;--ink:#211d18;--ink-soft:#6b6357;--hairline:#d9d2c4;--card:#fdfbf7;--accent:#b4430e;--agent:#ece7dc}
  @media (prefers-color-scheme: dark){
    :root{--paper:#161310;--ink:#e9e2d4;--ink-soft:#968d7d;--hairline:#332d25;--card:#1f1b16;--accent:#e8703a;--agent:#2a251e}
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:15px/1.55 "Avenir Next","Segoe UI",system-ui,sans-serif;background:var(--paper);color:var(--ink);min-height:100vh}
  main{max-width:720px;margin:0 auto;padding:28px 20px 120px}
  h1{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-size:24px;margin-bottom:4px}
  h1 em{font-style:italic;color:var(--accent)}
  .sub{color:var(--ink-soft);font-size:13px;margin-bottom:24px}
  form{display:grid;gap:12px}
  label{font-size:12.5px;color:var(--ink-soft)}
  input,select,textarea,button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--hairline);border-radius:4px;padding:9px 12px;width:100%}
  textarea{min-height:90px;resize:vertical}
  button{cursor:pointer;background:var(--accent);color:#fff;border:none;font-weight:600}
  button:disabled{opacity:.45;cursor:default}
  #status{font-size:12.5px;color:var(--ink-soft);margin:14px 0;padding:8px 12px;border-left:3px solid var(--accent);background:var(--card)}
  .msg{margin:10px 0;padding:11px 14px;border-radius:6px;white-space:pre-wrap;overflow-wrap:break-word}
  .msg.requester{background:var(--card);border:1px solid var(--hairline);margin-left:48px}
  .msg.agent{background:var(--agent);margin-right:48px}
  .msg .who{display:block;font-size:11px;color:var(--ink-soft);margin-bottom:4px;letter-spacing:.08em;text-transform:uppercase}
  .quick{display:flex;flex-wrap:wrap;gap:6px;margin:6px 48px 14px 0}
  .quick button{width:auto;font-size:12px;background:var(--card);color:var(--ink-soft);border:1px dashed var(--hairline);padding:5px 10px}
  .quick button:hover{border-color:var(--accent);color:var(--accent)}
  #setup-error{color:var(--accent);font-size:12.5px}
  #composer{position:fixed;inset:auto 0 0 0;background:var(--paper);border-top:1px solid var(--hairline);padding:14px 20px}
  #composer .inner{max-width:720px;margin:0 auto;display:flex;gap:10px}
  #composer button{width:auto;padding-inline:20px}
  .linkish{background:none;border:none;color:var(--accent);font-size:12.5px;width:auto;padding:0;text-decoration:underline}
  .hidden{display:none}
</style>
</head>
<body>
<main>
  <h1>pm-jude <em>· 요청 인테이크</em></h1>
  <p class="sub">요청을 남기면 몇 가지 표적 질문으로 내용을 정리해 requirements 문서로 만들어 드립니다.</p>

  <form id="setup">
    <div><label for="name">이름</label><input id="name" autocomplete="name" placeholder="홍길동"></div>
    <div><label for="language">언어 · Language</label>
      <select id="language"><option value="ko">한국어</option><option value="en">English</option></select></div>
    <div><label for="request">요청 내용</label><textarea id="request" required placeholder="예: 영업 실적 대시보드 하나 만들어 주세요"></textarea></div>
    <button type="submit">요청 보내기</button>
    <p id="setup-error" class="hidden" role="alert"></p>
  </form>

  <section id="chat" class="hidden">
    <div id="status"></div>
    <div id="log"></div>
    <button id="reset" class="linkish" type="button">새 요청 시작</button>
  </section>
</main>

<div id="composer" class="hidden"><div class="inner">
  <input id="answer" placeholder="답변을 입력하세요" autocomplete="off">
  <button id="send" type="button">보내기</button>
</div></div>

<script>
(function(){
  var KEY='pmjude.sessionId';
  var setup=document.getElementById('setup'),chat=document.getElementById('chat'),
      log=document.getElementById('log'),statusEl=document.getElementById('status'),
      composer=document.getElementById('composer'),answer=document.getElementById('answer'),
      send=document.getElementById('send');

  function esc(on,el){el.classList.toggle('hidden',!on)}
  function bubble(who,text){
    var d=document.createElement('div');d.className='msg '+who;
    var w=document.createElement('span');w.className='who';w.textContent=who==='requester'?'나':'pm-jude';
    d.appendChild(w);d.appendChild(document.createTextNode(text));log.appendChild(d);
    d.scrollIntoView({block:'end'});
  }
  // 질문별 「모르겠다 / 개발팀이 정할 문제」 1클릭 표시 (US-5) — 클릭하면 답변 입력란에 마크가 쌓인다
  function quickMarks(questions){
    if(!questions||!questions.length)return;
    var row=document.createElement('div');row.className='quick';
    questions.forEach(function(q){
      var b=document.createElement('button');b.type='button';
      b.textContent='Q'+q.index+' — '+q.dontKnowLabel;
      b.addEventListener('click',function(){
        var mark=q.index+'. '+q.dontKnowLabel;
        answer.value=answer.value?answer.value+' / '+mark:mark;
        answer.focus();
      });
      row.appendChild(b);
    });
    log.appendChild(row);row.scrollIntoView({block:'end'});
  }
  function renderReplies(replies){
    (replies||[]).forEach(function(r){bubble('agent',r.text);quickMarks(r.questions)});
  }
  function setStatus(status,terminalState){
    var open=status==='intake'||status==='clarifying';
    statusEl.textContent=
      status==='documented'?'requirements 문서가 전달됐습니다 — 아래에서 확인하세요.':
      status==='closed'?(terminalState==='on_hold_insufficient_info'
        ?'보류(정보 부족)로 종결됐습니다 — 새 요청으로 언제든 재개할 수 있어요.':'세션이 종결됐습니다.'):
      '명확화 진행 중 — 질문에 답해 주세요.';
    esc(open,composer);
  }
  function enterChat(){esc(false,setup);esc(true,chat)}

  function load(){
    var id=localStorage.getItem(KEY);
    if(!id)return;
    fetch('/api/sessions/'+encodeURIComponent(id)).then(function(r){
      if(!r.ok){localStorage.removeItem(KEY);return null}
      return r.json();
    }).then(function(d){
      if(!d)return;
      enterChat();log.textContent='';
      d.utterances.forEach(function(u){bubble(u.authorType==='requester'?'requester':'agent',u.originalText)});
      setStatus(d.session.status,d.session.terminalState);
    });
  }

  setup.addEventListener('submit',function(e){
    e.preventDefault();
    var text=document.getElementById('request').value.trim();
    if(!text)return;
    // 접수·질문 준비 동안의 침묵 방지 (US-2) — 즉시 진행 표시로 전환
    var submit=setup.querySelector('button[type=submit]');
    submit.disabled=true;submit.textContent='접수 중 — 질문을 준비하고 있어요…';
    fetch('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:document.getElementById('name').value.trim(),
        language:document.getElementById('language').value,text:text})
    }).then(function(r){return r.json()}).then(function(d){
      if(!d.sessionId){
        submit.disabled=false;submit.textContent='요청 보내기';
        var err=document.getElementById('setup-error');
        err.textContent=d.error||'요청 실패';err.classList.remove('hidden');return;
      }
      localStorage.setItem(KEY,d.sessionId);
      enterChat();bubble('requester',text);
      renderReplies(d.replies);
      setStatus(d.status,null);
    });
  });

  function sendAnswer(){
    var id=localStorage.getItem(KEY),text=answer.value.trim();
    if(!id||!text)return;
    send.disabled=true;
    fetch('/api/sessions/'+encodeURIComponent(id)+'/replies',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({text:text})
    }).then(function(r){return r.json()}).then(function(d){
      send.disabled=false;answer.value='';
      if(d.error){statusEl.textContent=d.error;return}
      bubble('requester',text);
      renderReplies(d.replies);
      setStatus(d.status,d.terminalState);
    });
  }
  send.addEventListener('click',sendAnswer);
  answer.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sendAnswer()}});

  document.getElementById('reset').addEventListener('click',function(){
    localStorage.removeItem(KEY);location.reload();
  });

  load();
})();
</script>
</body>
</html>
`;
