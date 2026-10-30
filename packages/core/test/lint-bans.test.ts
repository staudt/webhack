import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function errors(code: string, filePath: string): Promise<string[]> {
  const [res] = await eslint.lintText(code, { filePath });
  return (res?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? 'parse');
}

const CORE = 'packages/core/src/__fixture__.ts';

describe('determinism lint bans', () => {
  test.each([
    ['Math.random()', 'export const x = Math.random();', 'no-restricted-properties'],
    ['Date.now()', 'export const x = Date.now();', 'no-restricted-properties'],
    ['new Date()', 'export const x = new Date();', 'no-restricted-globals'],
    [
      'for-in',
      'export function f(o: object) { for (const k in o) { void k; } }',
      'no-restricted-syntax',
    ],
    ['window', 'export const x = window;', 'no-restricted-globals'],
  ])('%s is an error in core', async (_name, code, rule) => {
    expect(await errors(code, CORE)).toContain(rule);
  });

  test('same code is allowed outside core/content', async () => {
    const code = 'export const x = Math.random();';
    expect(await errors(code, 'packages/ui/src/__fixture__.ts')).toEqual([]);
  });

  test('Map, Set and structuredClone are allowed in core', async () => {
    const code = 'export const x = [new Map(), new Set(), structuredClone({})];';
    expect(await errors(code, CORE)).toEqual([]);
  });
});
