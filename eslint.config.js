import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // docs/는 정적 문서 + 벤더 에셋(mermaid.min.js), issues/는 data island 보드 — 린트 대상 아님.
  // web-ui/는 워크스페이스 멤버로 자체 ESLint(Next) 설정을 가진다 (ADR-0008).
  {
    ignores: [
      'node_modules/',
      'dist/',
      'drizzle/',
      'coverage/',
      'data/',
      'docs/',
      'issues/',
      'web-ui/',
    ],
  },
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
