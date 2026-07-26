import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // docs/는 정적 문서 + 벤더 에셋(mermaid.min.js), issues/는 data island 보드 — 린트 대상 아님
  { ignores: ['node_modules/', 'dist/', 'drizzle/', 'coverage/', 'data/', 'docs/', 'issues/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  prettier,
);
