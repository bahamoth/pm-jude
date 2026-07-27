// T1 짝 파일(`X.md` en / `X.ko.md` ko)의 헤딩 구조가 어긋났는지 검사한다.
// 번역 품질은 보지 않는다 — 한쪽에만 섹션이 생기거나 순서가 뒤집힌 것만 잡는다.
//
//   node scripts/check-bilingual-sync.mjs        불일치 시 exit 1
//
// CI에는 붙이지 않는다 (ADR-0009). PR을 열기 전에 손으로 돌린다.
import { readFileSync, existsSync } from 'node:fs';

/** T1 짝 파일. CONTEXT.md는 한 파일 병기라 여기 없다 — 규칙은 docs/agents/bilingual.md. */
const PAIRS = [
  ['README.md', 'README.ko.md'],
  ['docs/persona/jude.md', 'docs/persona/jude.ko.md'],
];

/** ```펜스 안의 #는 헤딩이 아니다. */
function headings(src) {
  const out = [];
  let fenced = false;
  for (const line of src.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
      if (m) out.push({ depth: m[1].length, text: m[2] });
    }
  }
  return out;
}

let failed = false;
const note = (msg) => {
  failed = true;
  console.error(msg);
};

for (const [en, ko] of PAIRS) {
  if (!existsSync(en) || !existsSync(ko)) {
    note(`bilingual-sync: 짝 파일 누락 — ${existsSync(en) ? ko : en}`);
    continue;
  }
  const a = headings(readFileSync(en, 'utf8'));
  const b = headings(readFileSync(ko, 'utf8'));

  if (a.length !== b.length) {
    note(`bilingual-sync: ${en} ↔ ${ko} — 헤딩 수 불일치 (${a.length} vs ${b.length})`);
  }
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].depth !== b[i].depth) {
      note(
        `bilingual-sync: ${en} ↔ ${ko} — ${i + 1}번째 헤딩 깊이 불일치 ` +
          `(h${a[i].depth} "${a[i].text}" vs h${b[i].depth} "${b[i].text}")`,
      );
    }
  }
  for (const [src, list] of [
    [en, a],
    [ko, b],
  ]) {
    if (list.length > n) {
      for (const h of list.slice(n)) note(`bilingual-sync: ${src}에만 있는 헤딩 — "${h.text}"`);
    }
  }
}

if (failed) process.exit(1);
console.log(`bilingual-sync ok — T1 짝 ${PAIRS.length}건`);
