import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

/**
 * 레이어드 설정 시임 (#59, ADR-0015) — 기본값 → 파일 → env, env가 최종 우선.
 * 파일·env는 주입으로 검증한다 — 테스트가 process.env와 실파일에 기대지 않는다.
 */

let tempDirs: string[] = [];
function tempConfigFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pm-jude-config-'));
  tempDirs.push(dir);
  const filePath = join(dir, 'pm-jude.config.json');
  writeFileSync(filePath, content);
  return filePath;
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('레이어드 설정 loadConfig()', () => {
  it('파일도 env도 없으면 스키마 기본값이 그대로 나온다', () => {
    const config = loadConfig({ filePath: '/없는/경로/pm-jude.config.json', env: {} });

    expect(config.web.port).toBe(8787);
    expect(config.db.path).toBe('./data/pm-jude.db');
    expect(config.intake.maxRounds).toBe(3);
    expect(config.intake.maxUtteranceChars).toBe(10_000);
    expect(config.llm.timeoutMs).toBe(120_000);
    expect(config.llm.maxConcurrency).toBe(2);
    expect(config.condense).toEqual({ targetChars: 16_000, budgetChars: 160_000 });
    expect(config.notion.apiKey).toBeNull();
  });

  it('설정 파일이 기본값을 덮는다 — 부분 지정도 나머지는 기본값 유지', () => {
    const filePath = tempConfigFile(
      JSON.stringify({ web: { port: 9000 }, intake: { maxRounds: 5 } }),
    );

    const config = loadConfig({ filePath, env: {} });

    expect(config.web.port).toBe(9000);
    expect(config.intake.maxRounds).toBe(5);
    expect(config.intake.teamLanguage).toBe('ko'); // 미지정 키는 기본값
  });

  it('env가 파일보다 우선한다 — 일회성 실행 주입이 정착 설정을 이긴다', () => {
    const filePath = tempConfigFile(
      JSON.stringify({ web: { port: 9000 }, llm: { fakeBackend: false, model: 'file-model' } }),
    );

    const config = loadConfig({
      filePath,
      env: { PMJUDE_WEB_PORT: '9999', PMJUDE_FAKE_BACKEND: '1' },
    });

    expect(config.web.port).toBe(9999); // env 문자열이 숫자로 강제된다
    expect(config.llm.fakeBackend).toBe(true);
    expect(config.llm.model).toBe('file-model'); // env가 건드리지 않은 키는 파일 값 유지
  });

  it('비밀 토큰도 파일에서 받고 env가 우선한다 (ADR-0015 결정 2)', () => {
    const filePath = tempConfigFile(
      JSON.stringify({ notion: { apiKey: 'ntn_file' }, linear: { apiKey: 'lin_file' } }),
    );

    const config = loadConfig({ filePath, env: { NOTION_API_KEY: 'ntn_env' } });

    expect(config.notion.apiKey).toBe('ntn_env');
    expect(config.linear.apiKey).toBe('lin_file');
  });

  it('PMJUDE_CONFIG env로 파일 위치를 바꿀 수 있다', () => {
    const filePath = tempConfigFile(JSON.stringify({ web: { port: 8888 } }));

    const config = loadConfig({ env: { PMJUDE_CONFIG: filePath } });

    expect(config.web.port).toBe(8888);
  });

  it('깨진 JSON은 기동 시점에 명시적으로 거부한다', () => {
    const filePath = tempConfigFile('{ web: 주석은 JSON이 아니다');

    expect(() => loadConfig({ filePath, env: {} })).toThrow(ConfigError);
    expect(() => loadConfig({ filePath, env: {} })).toThrow(/JSON/);
  });

  it('미지 키는 조용히 무시되지 않고 거부된다 — 오타 보호', () => {
    const filePath = tempConfigFile(JSON.stringify({ web: { prot: 9000 } }));

    expect(() => loadConfig({ filePath, env: {} })).toThrow(ConfigError);
  });

  it('타입이 틀린 값(음수 포트·숫자 아님)은 거부된다', () => {
    expect(() =>
      loadConfig({ filePath: '/없음', env: { PMJUDE_WEB_PORT: '팔천칠백팔십칠' } }),
    ).toThrow(ConfigError);
    const filePath = tempConfigFile(JSON.stringify({ intake: { maxRounds: -1 } }));
    expect(() => loadConfig({ filePath, env: {} })).toThrow(ConfigError);
  });
});
