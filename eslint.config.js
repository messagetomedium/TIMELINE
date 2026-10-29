import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.app.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    files: ['src/domain/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['react', 'react-dom*', '**/application/**', '**/infrastructure/**', '**/features/**', '**/app/**'] }] },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['react', 'react-dom*', '**/infrastructure/**', '**/features/**', '**/app/**'] }] },
  },
  {
    files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/infrastructure/**', '**/app/**'] }] },
  },
);
