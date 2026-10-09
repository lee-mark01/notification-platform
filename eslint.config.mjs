import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // scripts/capture holds local, untracked screenshot tooling.
    ignores: ['dist/', 'coverage/', 'eslint.config.mjs', 'scripts/capture/'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Unawaited promises in queue and worker code silently drop errors.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain browser and Node scripts for the web push demo, outside tsconfig.
    files: ['web-push-demo/**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.node,
        firebase: 'readonly',
      },
    },
  },
  {
    // Plain Node scripts for load experiments, outside tsconfig.
    files: ['load/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
