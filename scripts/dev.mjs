// pnpm dev — API 서버(pnpm web)와 웹 UI(pnpm web:ui)를 한 번에 띄운다.
// 환경 변수는 그대로 상속된다: PMJUDE_FAKE_BACKEND=1 pnpm dev (데모 모드)
// 한쪽이 죽으면 전체를 내린다 — 반쪽 스택으로 헤매지 않게.
import { spawn } from 'node:child_process';

const procs = [];
let shuttingDown = false;

function run(name, args) {
  // detached: 자체 프로세스 그룹 — pnpm이 손자(tsx·next)에 시그널을 안 넘기므로 그룹째 내린다
  const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`${prefix}종료 (code ${code ?? 'signal'}) — 전체를 내립니다`);
    shutdown(code ?? 1);
  });
  procs.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of procs) {
    try {
      process.kill(-child.pid, 'SIGTERM'); // 프로세스 그룹 전체
    } catch {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// api는 tsx watch — src/ 수정 시 자동 재시작 (세션은 SQLite 영속이라 이어진다).
// ui는 next dev의 Fast Refresh. 감시 없는 1회 실행이 필요하면 pnpm web을 따로 쓴다.
run('api', ['web:watch']);
run('ui', ['web:ui']);
