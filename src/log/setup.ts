import { resolve } from 'node:path';
import { installConsoleTee } from './console-tee';
import { createRollingFileSink } from './rolling-file';

/**
 * 엔트리포인트 1줄 배선 (#55) — 콘솔 출력의 영속 사본을 `data/logs/<name>.log`에 남긴다.
 *
 * 파일은 엔트리포인트별로 나뉜다: web과 slack이 동시에 뜰 수 있어, 두 프로세스가
 * 같은 파일을 로테이션하면 rename 경합이 생기기 때문이다. 경로·정책은 AGENTS.md 참조.
 */
export function setupBackendLog(name: string): void {
  const path = resolve(process.env.PMJUDE_LOG_FILE ?? `./data/logs/${name}.log`);
  installConsoleTee(createRollingFileSink({ path }));
}
