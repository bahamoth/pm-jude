import { GRAYSCALE_TOKENS, type MockupTheme } from './theme-registry';

/**
 * 목업 서빙 렌더러 (F4, #54) — 구조 층 HTML에 테마와 워터마크를 입힌다.
 * 워터마크 상시와 테마 주입은 하드 제약이라 프롬프트에 부탁하지 않고 여기서 보장한다(원칙 2).
 * 테마 미선정(반복 단계)은 그레이스케일 기본값이다 — F4의 그레이스케일 규정.
 */

const WATERMARK_TEXT = {
  ko: '요구사항 확인용 목업 — 구현 결과 아님',
  en: 'Requirements-confirmation mockup — not the implementation',
} as const;

/** :root 토큰 규칙 — 테마 토큰이 그레이스케일 기본값을 덮는다. */
function themeStyle(theme?: MockupTheme): string {
  const tokens = { ...GRAYSCALE_TOKENS, ...theme?.tokens };
  const vars = Object.entries(tokens)
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
  return `:root { ${vars} }\n${theme?.css ?? ''}`;
}

export function renderMockupHtml(input: {
  html: string;
  theme?: MockupTheme;
  language: 'ko' | 'en';
}): string {
  const watermark = WATERMARK_TEXT[input.language];
  const injection = `<style data-pj-theme>${themeStyle(input.theme)}
.pj-watermark { position: fixed; bottom: 12px; right: 12px; z-index: 9999;
  padding: 6px 12px; background: rgba(20, 20, 20, 0.78); color: #fff;
  font: 12px/1.4 system-ui, sans-serif; border-radius: 4px; pointer-events: none; }
</style>
<div class="pj-watermark">${watermark}</div>`;
  // 구조 층은 LLM 산출물이다 — </body>가 없어도 주입이 빠지지 않게 폴백은 뒤에 덧붙인다
  if (input.html.includes('</body>')) {
    return input.html.replace('</body>', `${injection}</body>`);
  }
  return input.html + injection;
}
