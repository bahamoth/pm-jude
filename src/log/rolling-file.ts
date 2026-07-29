import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 롤링 파일 sink (#55) — 백엔드 콘솔 로그의 영속 사본을 만든다.
 *
 * LLM 에이전트가 런타임 실패(타임아웃 등)를 콘솔 복사 없이 스스로 읽게 하는 용도.
 * 쓰기는 동기다 — 사용량·라운드 로그 수준의 저빈도 출력이 전제이며, 프로세스가
 * 죽기 직전의 마지막 라인이 가장 중요한 로그이기 때문이다.
 */
export interface RollingFileOptions {
  path: string;
  /** 활성 파일의 상한(바이트). 이 크기를 넘길 쓰기 전에 로테이션한다. 기본 5MB. */
  maxBytes?: number;
  /** 활성 파일을 포함한 총 보관 세대 수. 초과하는 가장 오래된 세대는 삭제. 기본 5. */
  maxFiles?: number;
}

export interface LogSink {
  write(line: string): void;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

export function createRollingFileSink(options: RollingFileOptions): LogSink {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  mkdirSync(dirname(options.path), { recursive: true });
  return {
    write(line: string): void {
      const payload = line + '\n';
      const size = currentSize(options.path);
      // size 0이면 로테이션 불가·불필요 — 상한보다 큰 단일 라인도 일단 기록된다
      if (size > 0 && size + Buffer.byteLength(payload) > maxBytes) {
        rotate(options.path, maxFiles);
      }
      appendFileSync(options.path, payload);
    },
  };
}

/** `path → path.1 → … → path.(maxFiles-1)` 세대 시프트. 마지막 세대는 삭제된다. */
function rotate(path: string, maxFiles: number): void {
  rmSync(`${path}.${maxFiles - 1}`, { force: true });
  for (let i = maxFiles - 2; i >= 1; i--) {
    if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
  }
  renameSync(path, `${path}.1`);
}

function currentSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
