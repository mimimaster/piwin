// Workspace lint gate. TypeScript (`pnpm typecheck`) stays the primary type
// gate; ESLint enforces the AGENTS.md rules the compiler cannot see: no
// floating promises, no silent empty catch, React hook rules.
//
// One root run (`pnpm lint`) covers every package; packages have no own lint
// script. Errors fail CI; warnings (exhaustive-deps, non-null assertions) are
// a worklist, not a gate.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const TYPE_AWARE_SOURCES = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'];
const TEST_SOURCES = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/e2e/**',
  '**/*harness*.{ts,tsx}',
  '**/*test-helpers*.{ts,tsx}',
  '**/*test-support*.{ts,tsx}',
];

export default defineConfig(
  {
    ignores: [
      '.claude/**',
      '.playwright-mcp/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-*/**',
      '**/build/**',
      '**/coverage/**',
      '**/target/**',
      '**/*.d.ts',
      'apps/desktop/src-tauri/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      'apps/docs/**',
      'apps/desktop/playwright-report/**',
      'apps/desktop/test-results/**',
      'docs/**',
      'plans/**',
      'fixtures/**',
      'skills/**',
      'scripts/**',
      'crates/**',
      // Pi extension packages: loaded by Pi, outside every workspace tsconfig.
      'packages/agent-host/bundled-extensions/**',
      'packages/agent-host/standalone-extensions/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // AGENTS.md §5: silent `catch (e) {}` is banned. A comment inside the
      // block is required when ignoring is intended.
      'no-empty': ['error', { allowEmptyCatch: false }],
      // `let x; const finish = () => x?.(); x = subscribe(finish);` is the
      // normal teardown shape for callbacks registered after their handler.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      // `tsc` owns unused checks per package (noUnusedLocals where enabled).
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    files: TYPE_AWARE_SOURCES,
    ignores: TEST_SOURCES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // AGENTS.md §3.3: `await` or explicitly `void` — no floating promises.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Tests stub loosely and assert on known-present values; the production
    // rules above are what AGENTS.md §3.1 binds.
    files: TEST_SOURCES,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'prefer-rest-params': 'off',
    },
  },
  {
    files: ['{apps/desktop,apps/mobile,packages/ui-kit}/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
