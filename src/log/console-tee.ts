import { format } from 'node:util';
import type { LogSink } from './rolling-file';

/**
 * 콘솔 티 (#55) — console.log/warn/error의 출력을 유지한 채 같은 내용을 sink에 병행 기록한다.
 *
 * 운영자가 보는 콘솔은 한 글자도 변하지 않는다. sink 라인에만 ISO 타임스탬프가 붙는다 —
 * 콘솔은 실시간이라 시각이 불필요하지만, 파일은 사후에 읽히므로 시각이 곧 맥락이다.
 */
export function installConsoleTee(sink: LogSink): () => void {
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const tee =
    (original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      original.apply(console, args);
      sink.write(`${new Date().toISOString()} ${format(...args)}`);
    };
  console.log = tee(originals.log);
  console.warn = tee(originals.warn);
  console.error = tee(originals.error);
  return () => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  };
}
