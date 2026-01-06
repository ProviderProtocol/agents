import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // AirBnB style rules
      'no-console': 'off',
      'import/prefer-default-export': 'off',
      'import/extensions': 'off',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-unused-vars': 'off',
      'max-classes-per-file': 'off',
      'class-methods-use-this': 'off',
      'no-continue': 'off',
      'no-await-in-loop': 'off',
      'no-restricted-syntax': 'off',
      'no-plusplus': 'off',

      // General best practices
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',
      'no-param-reassign': ['error', { props: false }],
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '*.js'],
  },
];
