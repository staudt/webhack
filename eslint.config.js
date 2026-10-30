import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const BANNED_GLOBALS = [
  'Date',
  'performance',
  'crypto',
  'window',
  'document',
  'self',
  'navigator',
  'localStorage',
  'indexedDB',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
];
const msg = 'Banned in core/content (determinism/headless rule 1-2). Use ctx.rng.';
const banProps = [
  ['Math', 'random'],
  ['Date', 'now'],
  ['performance', 'now'],
  ['crypto', 'getRandomValues'],
  ['crypto', 'randomUUID'],
];

export default tseslint.config(
  { ignores: ['vendor/**', '**/dist/**', 'coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { files: ['**/*.cjs'], languageOptions: { globals: globals.node, sourceType: 'commonjs' } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts', 'packages/content/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...BANNED_GLOBALS.map((name) => ({ name, message: msg }))],
      'no-restricted-properties': [
        'error',
        ...banProps.map(([object, property]) => ({ object, property, message: msg })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'Key order must not affect outcomes; iterate sorted arrays.',
        },
      ],
    },
  },
);
