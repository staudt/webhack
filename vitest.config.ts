import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['packages/app/**', '**/index.ts', '**/types/**'],
      thresholds: {
        'packages/core/src/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
      },
    },
  },
});
