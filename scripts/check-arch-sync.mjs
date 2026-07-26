// ARCHITECTURE.md의 ```mermaid 블록(정본)과 docs/architecture.html의
// <pre class="mermaid"> 블록(미러)이 일치하는지 검사한다.
//
//   node scripts/check-arch-sync.mjs          검사만 — 불일치 시 exit 1
//   node scripts/check-arch-sync.mjs --write  정본 블록을 HTML에 주입해 동기화
import { readFileSync, writeFileSync } from 'node:fs';

const MD = 'ARCHITECTURE.md';
const HTML = 'docs/architecture.html';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeHtml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const md = readFileSync(MD, 'utf8');
const canonical = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim());

let html = readFileSync(HTML, 'utf8');
const preRe = /(<pre class="mermaid" data-block="(\d+)">)([\s\S]*?)(<\/pre>)/g;

if (process.argv.includes('--write')) {
  let count = 0;
  html = html.replace(preRe, (_, open, idx, _body, close) => {
    const src = canonical[Number(idx)];
    if (src === undefined) throw new Error(`정본에 없는 블록 인덱스: ${idx}`);
    count++;
    return `${open}\n${escapeHtml(src)}\n${close}`;
  });
  if (count !== canonical.length)
    throw new Error(`블록 수 불일치 — 정본 ${canonical.length}개, HTML ${count}개`);
  writeFileSync(HTML, html);
  console.log(`arch-sync: ${count}개 블록 주입 완료`);
} else {
  const mirrored = [...html.matchAll(preRe)].map((m) => ({
    idx: Number(m[2]),
    src: unescapeHtml(m[3]).trim(),
  }));
  if (mirrored.length !== canonical.length) {
    console.error(`arch-sync 실패: 정본 ${canonical.length}개, HTML ${mirrored.length}개`);
    process.exit(1);
  }
  let ok = true;
  for (const { idx, src } of mirrored) {
    if (src !== canonical[idx]) {
      ok = false;
      console.error(`arch-sync 실패: 블록 ${idx} 불일치 (data-block="${idx}")`);
    }
  }
  if (!ok) process.exit(1);
  console.log(`arch-sync: ${canonical.length}개 블록 일치`);
}
