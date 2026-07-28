import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * 목업 테마 (F4 디자인 시스템 선정, #54) — 구조 층 HTML이 소비하는 --pj-* 토큰의 한 벌.
 * 반복 단계의 기본값은 그레이스케일이고, 테마는 레이아웃 수렴 뒤 선정 후보로만 입혀진다
 * (F4 그레이스케일 규정의 선정 단계 예외).
 */
export interface MockupTheme {
  id: string;
  name: string;
  description: string;
  /** CSS 변수 토큰 (--pj-*) → 값. 렌더러가 :root 규칙으로 주입한다. */
  tokens?: Record<string, string>;
  /** 토큰으로 표현되지 않는 외부 디자인 시스템용 원시 CSS (선택). */
  css?: string;
  source: 'builtin' | 'external';
}

/**
 * 구조 층 HTML이 소비하는 토큰 계약 — 목업 프롬프트와 렌더러가 공유한다.
 * 그레이스케일 기본값: 테마가 선정되기 전의 반복 단계 모습이다 (F4).
 */
export const GRAYSCALE_TOKENS: Record<string, string> = {
  '--pj-bg': '#f5f5f5',
  '--pj-surface': '#ffffff',
  '--pj-fg': '#1f1f1f',
  '--pj-muted': '#6b6b6b',
  '--pj-border': '#d4d4d4',
  '--pj-accent': '#4a4a4a',
  '--pj-accent-fg': '#ffffff',
  '--pj-radius': '6px',
  '--pj-font': "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif",
};

const BUILTIN_THEMES: MockupTheme[] = [
  {
    id: 'daylight',
    name: '데이라이트',
    description: '밝은 바탕에 차분한 블루 포인트 — 업무 도구의 기본형',
    tokens: {
      '--pj-bg': '#f6f8fb',
      '--pj-surface': '#ffffff',
      '--pj-fg': '#16233a',
      '--pj-muted': '#5b6b84',
      '--pj-border': '#d7dfeb',
      '--pj-accent': '#2f6fed',
      '--pj-accent-fg': '#ffffff',
      '--pj-radius': '8px',
    },
    source: 'builtin',
  },
  {
    id: 'midnight',
    name: '미드나이트',
    description: '어두운 바탕의 대시보드형 — 장시간 모니터링 화면에 맞음',
    tokens: {
      '--pj-bg': '#101522',
      '--pj-surface': '#1a2233',
      '--pj-fg': '#e8ecf4',
      '--pj-muted': '#9aa6bd',
      '--pj-border': '#2c3850',
      '--pj-accent': '#5b8def',
      '--pj-accent-fg': '#0d1320',
      '--pj-radius': '8px',
    },
    source: 'builtin',
  },
  {
    id: 'terracotta',
    name: '테라코타',
    description: '따뜻한 웜톤 포인트 — 대면·소비자향 화면에 맞음',
    tokens: {
      '--pj-bg': '#faf6f1',
      '--pj-surface': '#ffffff',
      '--pj-fg': '#2d2320',
      '--pj-muted': '#7a6a62',
      '--pj-border': '#e5d9cf',
      '--pj-accent': '#d96f4e',
      '--pj-accent-fg': '#ffffff',
      '--pj-radius': '10px',
    },
    source: 'builtin',
  },
];

/**
 * 선정 후보의 출처 — 내장 프리셋 + 외부 등록(디자인 토큰 JSON·원시 CSS 파일)을
 * 같은 인터페이스로 나열한다. 같은 id의 외부 테마는 내장을 덮는다: 조직 표준이
 * 정해지면 코드 수정 없이 프리셋을 대체할 수 있어야 한다 (운영자 지시 2026-07-28).
 */
export class ThemeRegistry {
  private readonly themes = new Map<string, MockupTheme>();

  static withBuiltins(): ThemeRegistry {
    const registry = new ThemeRegistry();
    for (const theme of BUILTIN_THEMES) registry.register(theme);
    return registry;
  }

  register(theme: MockupTheme): void {
    this.themes.set(theme.id, theme);
  }

  get(id: string): MockupTheme | undefined {
    return this.themes.get(id);
  }

  list(): MockupTheme[] {
    return [...this.themes.values()];
  }

  /**
   * 외부 테마 디렉터리 로드 — *.theme.json(디자인 토큰)과 *.theme.css(원시 CSS)를 읽는다.
   * 깨진 파일은 건너뛴다: 파일 하나가 선정 후보 전체를 죽이지 않는다. 등록한 수를 돌려준다.
   */
  loadDirectory(dir: string): number {
    let loaded = 0;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      try {
        if (entry.endsWith('.theme.json')) {
          const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
          const theme = parseTokenTheme(parsed);
          if (!theme) continue;
          this.register(theme);
          loaded++;
        } else if (entry.endsWith('.theme.css')) {
          const id = basename(entry, '.theme.css');
          this.register({
            id,
            name: id,
            description: '외부 등록 CSS 테마',
            css: readFileSync(path, 'utf8'),
            source: 'external',
          });
          loaded++;
        }
      } catch {
        continue; // 깨진 파일 — 건너뛴다
      }
    }
    return loaded;
  }
}

/** 토큰 테마 JSON의 런타임 검증 — 외부 파일이라 형태를 믿지 않는다. */
function parseTokenTheme(parsed: unknown): MockupTheme | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { id, name, description, tokens } = parsed as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) return null;
  if (typeof tokens !== 'object' || tokens === null) return null;
  const entries = Object.entries(tokens as Record<string, unknown>).filter(
    (pair): pair is [string, string] => typeof pair[1] === 'string',
  );
  return {
    id,
    name,
    description: typeof description === 'string' ? description : '외부 등록 테마',
    tokens: Object.fromEntries(entries),
    source: 'external',
  };
}
