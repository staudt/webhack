import { readFileSync } from 'node:fs';
import { vanillaMod } from '@nh/content';
import { describe, expect, test } from 'vitest';
import { recordGame, runReplay, soak } from '../src/index';

interface Golden {
  seed: number;
  botSeed: number;
  turns: number;
  actions: number;
  hash: string;
}

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'),
) as Golden;

const CHANGED_MESSAGE =
  'Golden replay changed. If this change in game behavior is intended, update packages/testkit/test/fixtures/golden.json in the same commit and explain why in the commit message.';

describe('golden replay', () => {
  test('a soak run reproduces the pinned action count and final hash', { timeout: 60000 }, () => {
    const soaked = soak([vanillaMod], {
      seed: golden.seed,
      turns: golden.turns,
      botSeed: golden.botSeed,
      checkEvery: 50,
    });
    expect(soaked.violations).toBeNull();

    const recorded = recordGame(
      [vanillaMod],
      { seed: golden.seed, width: 80, height: 21 },
      soaked.log,
    );
    expect(soaked.actions, CHANGED_MESSAGE).toBe(golden.actions);
    expect(recorded.hash, CHANGED_MESSAGE).toBe(golden.hash);
    expect(soaked.finalHash, CHANGED_MESSAGE).toBe(golden.hash);

    const replayed = runReplay([vanillaMod], recorded);
    expect(replayed.hash, CHANGED_MESSAGE).toBe(golden.hash);
  });
});
