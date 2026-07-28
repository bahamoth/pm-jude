import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThemeRegistry } from '../src/mockup/theme-registry';

/**
 * 테마 레지스트리 (F4 디자인 시스템 선정, #54) — 내장 프리셋과 외부 등록 테마가
 * 같은 인터페이스로 나열·조회된다. 외부 수용은 운영자 지시(2026-07-28):
 * 조직 표준 디자인 시스템이 정해지면 코드 수정 없이 파일 등록으로 후보에 반영된다.
 */
describe('테마 레지스트리 — 내장 프리셋', () => {
  it('내장 프리셋이 등록되어 나열되고 id로 조회된다', () => {
    const registry = ThemeRegistry.withBuiltins();

    const themes = registry.list();
    expect(themes.length).toBeGreaterThanOrEqual(2);
    const first = themes[0]!;
    expect(registry.get(first.id)?.name).toBe(first.name);
    expect(themes.every((theme) => theme.source === 'builtin')).toBe(true);
  });

  it('없는 id 조회는 undefined — 선정 API가 거부 근거로 쓴다', () => {
    expect(ThemeRegistry.withBuiltins().get('no-such-theme')).toBeUndefined();
  });
});

describe('테마 레지스트리 — 외부 등록 (파일 픽스처)', () => {
  it('디자인 토큰 JSON(*.theme.json)을 외부 테마로 등록한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-jude-themes-'));
    writeFileSync(
      join(dir, 'org-standard.theme.json'),
      JSON.stringify({
        id: 'org-standard',
        name: '조직 표준',
        description: '사내 디자인 시스템 토큰',
        tokens: { '--pj-bg': '#0b1e3f', '--pj-accent': '#ff6b57' },
      }),
    );

    const registry = ThemeRegistry.withBuiltins();
    const loaded = registry.loadDirectory(dir);

    expect(loaded).toBe(1);
    const theme = registry.get('org-standard');
    expect(theme?.source).toBe('external');
    expect(theme?.tokens?.['--pj-accent']).toBe('#ff6b57');
    // 내장과 외부가 한 목록에 — 선정 후보는 이 목록에서 나온다
    expect(registry.list().some((entry) => entry.id === 'org-standard')).toBe(true);
  });

  it('원시 CSS(*.theme.css)도 파일명 id로 등록한다 — 토큰으로 부족한 외부 시스템용', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-jude-themes-'));
    writeFileSync(join(dir, 'brand-x.theme.css'), ':root { --pj-bg: #fff8f0; }');

    const registry = ThemeRegistry.withBuiltins();
    registry.loadDirectory(dir);

    const theme = registry.get('brand-x');
    expect(theme?.source).toBe('external');
    expect(theme?.css).toContain('--pj-bg: #fff8f0');
  });

  it('깨진 테마 파일은 건너뛰고 나머지를 등록한다 — 파일 하나가 후보 전체를 죽이지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-jude-themes-'));
    writeFileSync(join(dir, 'broken.theme.json'), '{ not json');
    writeFileSync(
      join(dir, 'ok.theme.json'),
      JSON.stringify({ id: 'ok', name: '정상', tokens: {} }),
    );

    const registry = ThemeRegistry.withBuiltins();
    const loaded = registry.loadDirectory(dir);

    expect(loaded).toBe(1);
    expect(registry.get('ok')).toBeDefined();
    expect(registry.get('broken')).toBeUndefined();
  });

  it('같은 id의 외부 테마가 내장을 덮는다 — 조직 표준이 프리셋보다 우선한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-jude-themes-'));
    const builtin = ThemeRegistry.withBuiltins().list()[0]!;
    writeFileSync(
      join(dir, 'override.theme.json'),
      JSON.stringify({ id: builtin.id, name: '조직판', tokens: {} }),
    );

    const registry = ThemeRegistry.withBuiltins();
    registry.loadDirectory(dir);

    expect(registry.get(builtin.id)?.name).toBe('조직판');
    // 덮어써도 후보 수는 늘지 않는다
    expect(registry.list().filter((theme) => theme.id === builtin.id).length).toBe(1);
  });
});
