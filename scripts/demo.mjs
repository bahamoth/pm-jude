// pnpm demo — 다른 사람에게 보여주기 위한 구성. API 서버 + 빌드된 UI를 함께 띄운다.
//
// pnpm dev와의 차이는 UI를 next dev가 아니라 프로덕션 빌드로 서빙한다는 것이다. dev 서버는
// 루프백 밖 origin의 dev 리소스(/_next, /__nextjs)를 403으로 막고 HMR 소켓이 계속 재연결을
// 시도하므로, 여러 사람이 보는 화면에는 맞지 않는다. 빌드된 UI에는 그 검사도 소켓도 없다.
//
// API 서버는 루프백에만 바인딩된 채로 둔다(ADR-0007) — Next가 /api·/board·/trace를 서버
// 사이드에서 프록시하므로 밖에서 열려야 하는 포트는 UI 하나뿐이다.
//
//   pnpm demo                        빌드가 없으면 먼저 만들고 띄운다
//   pnpm demo --build                이미 있어도 다시 빌드한다
//   PMJUDE_FAKE_BACKEND=1 pnpm demo  LLM 자격 증명 없이 결정론적 시나리오로
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_PORT = process.env.PMJUDE_UI_PORT ?? '3000';
const BUILD_ID = join(ROOT, 'web-ui', '.next', 'BUILD_ID');

/** 이 머신이 LAN에 내보이는 주소 — 데모에서 남에게 알려줄 링크다. */
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

const rebuild = process.argv.includes('--build');
if (rebuild || !existsSync(BUILD_ID)) {
  console.error(rebuild ? '[demo] UI 다시 빌드…' : '[demo] 빌드 산출물이 없어 먼저 빌드합니다…');
  const built = spawnSync('pnpm', ['--dir', 'web-ui', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) {
    console.error('[demo] 빌드 실패 — 중단합니다');
    process.exit(built.status ?? 1);
  }
} else {
  console.error('[demo] 기존 빌드를 사용합니다 (소스를 고쳤다면 pnpm demo --build)');
}

const procs = [];
let shuttingDown = false;

function run(name, args) {
  // detached: 자체 프로세스 그룹 — pnpm이 손자(tsx·next)에 시그널을 안 넘기므로 그룹째 내린다
  const child = spawn('pnpm', args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
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

// api는 감시 없이 1회 실행 — 데모 중 재시작으로 세션이 끊기지 않게 (pnpm dev는 tsx watch)
run('api', ['web']);
// ui는 빌드된 산출물. 0.0.0.0으로 명시해 다른 기기에서 붙을 수 있게 한다
run('ui', ['--dir', 'web-ui', 'exec', 'next', 'start', '-H', '0.0.0.0', '-p', UI_PORT]);

const hosts = lanAddresses();
console.error('');
console.error(`[demo] 이 기기:   http://localhost:${UI_PORT}/`);
for (const host of hosts) console.error(`[demo] 다른 기기: http://${host}:${UI_PORT}/`);
if (hosts.length === 0)
  console.error('[demo] LAN 주소를 찾지 못했습니다 — 네트워크 연결을 확인하세요');
console.error(`[demo] 이슈 보드 /board · 세션 트레이스 /trace 도 같은 주소에서 열립니다`);
console.error('');
