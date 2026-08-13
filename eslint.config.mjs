import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

const MAX_LEN = ['error', { code: 100, ignoreUrls: true, ignoreRegExpLiterals: true }];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'media/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.svsch/**',
      'build_sv*/**',
      '.vscode-test/**',
      '.bdd-generated/**',
      'src/parser/backend_cpp/**',
      'test/bdd-workspace/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/webview/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/webview/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
    },
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Test fixtures assert on values known to exist after parsing/layout;
      // the extra strictness here isn't worth the noise.
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The codebase uses `any` extensively in parser/geometry code where
      // precise typing isn't practical yet; keep it visible but non-blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Optional-dependency detection (e.g. `require('vscode')` in a
      // try/catch) needs CJS require, not static import.
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // eslint-config-prettier disables max-len on the assumption Prettier's
      // printWidth covers it, but Prettier only wraps what it safely can
      // (e.g. it won't break up long strings/comments) — keep it as a hard cap.
      'max-len': MAX_LEN,
    },
  },
);
