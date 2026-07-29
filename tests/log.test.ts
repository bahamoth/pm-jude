import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConsoleTee } from '../src/log/console-tee';
import { createRollingFileSink } from '../src/log/rolling-file';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pm-jude-log-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('롤링 파일 sink', () => {
  it('라인을 파일에 덧붙이고, 없는 부모 디렉터리는 만들어서 쓴다', () => {
    const dir = makeTempDir();
    const path = join(dir, 'logs', 'web.log');

    const sink = createRollingFileSink({ path });
    sink.write('[usage] requirements@0.2.0 시도1 timeout 120001ms');
    sink.write('[web] 라운드 실패: GatewayTimeoutError');

    expect(readFileSync(path, 'utf8')).toBe(
      '[usage] requirements@0.2.0 시도1 timeout 120001ms\n[web] 라운드 실패: GatewayTimeoutError\n',
    );
  });

  it('maxBytes를 넘길 쓰기는 먼저 로테이션한다 — 활성 파일이 .1로 밀리고 새 파일에 쓴다', () => {
    const dir = makeTempDir();
    const path = join(dir, 'web.log');

    const sink = createRollingFileSink({ path, maxBytes: 20 });
    sink.write('aaaaaaaaaa'); // 11바이트 — 상한 이내
    sink.write('bbbbbbbbbb'); // 11바이트 — 합치면 22 > 20이므로 로테이션 후 기록

    expect(readFileSync(`${path}.1`, 'utf8')).toBe('aaaaaaaaaa\n');
    expect(readFileSync(path, 'utf8')).toBe('bbbbbbbbbb\n');
  });

  it('로테이션마다 세대가 밀리고(.1→.2), maxFiles를 넘는 가장 오래된 세대는 삭제된다', () => {
    const dir = makeTempDir();
    const path = join(dir, 'web.log');

    // maxFiles 3 = 활성 + .1 + .2 — 네 세대를 만들면 첫 세대는 버려져야 한다
    const sink = createRollingFileSink({ path, maxBytes: 10, maxFiles: 3 });
    for (const generation of ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd']) {
      sink.write(generation);
    }

    expect(readFileSync(path, 'utf8')).toBe('dddddddddd\n');
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('cccccccccc\n');
    expect(readFileSync(`${path}.2`, 'utf8')).toBe('bbbbbbbbbb\n');
    expect(existsSync(`${path}.3`)).toBe(false);
  });
});

describe('콘솔 티', () => {
  it('설치 전 콘솔 메서드를 동일 인자로 그대로 호출하면서, 같은 내용을 ISO 타임스탬프 라인으로 sink에 기록한다', () => {
    const lines: string[] = [];
    const consoleCalls: unknown[][] = [];
    // 티 설치 전의 콘솔 = 운영자가 보던 출력 경로. 기록기로 바꿔치기해 통과 여부를 관찰한다.
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => consoleCalls.push(['log', ...args]));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => consoleCalls.push(['error', ...args]));
    const uninstall = installConsoleTee({ write: (line) => lines.push(line) });
    try {
      console.log('[usage] %s 시도%d ok', 'completeness@0.2.0', 1);
      console.error('[web] 라운드 실패: GatewayTimeoutError');

      // 원본 출력 유지 — 기존 콘솔 메서드가 인자 변형 없이 호출된다
      expect(consoleCalls).toEqual([
        ['log', '[usage] %s 시도%d ok', 'completeness@0.2.0', 1],
        ['error', '[web] 라운드 실패: GatewayTimeoutError'],
      ]);

      // sink에는 포맷 완료된 본문 앞에 ISO 타임스탬프가 붙는다
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[usage\] completeness@0\.2\.0 시도1 ok$/,
      );
      expect(lines[1]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[web\] 라운드 실패: GatewayTimeoutError$/,
      );
    } finally {
      uninstall();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
