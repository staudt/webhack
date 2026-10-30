import { vanillaMod } from '@nh/content';
import { describe, expect, test } from 'vitest';
import { soak } from '../src/index';

describe('soak', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`seed ${seed}: 2000 turns at 80x21`, { timeout: 10000 }, () => {
      const r = soak([vanillaMod], { seed, turns: 2000, width: 80, height: 21, checkEvery: 10 });
      console.log(`soak 80x21 seed=${seed}: actions=${r.actions} turns=${r.turns} explored=${r.cellsExplored}`);
      expect(r.violations).toBeNull();
      expect(r.turns).toBeGreaterThanOrEqual(2000);
      expect(r.cellsExplored).toBeGreaterThan(50);
    });
  }

  test('200x200, 500 turns', { timeout: 30000 }, () => {
    const r = soak([vanillaMod], { seed: 11, turns: 500, width: 200, height: 200, checkEvery: 25 });
    console.log(`soak 200x200: actions=${r.actions} turns=${r.turns} explored=${r.cellsExplored}`);
    expect(r.violations).toBeNull();
    expect(r.cellsExplored).toBeGreaterThan(50);
  });

  test('soak is deterministic', { timeout: 10000 }, () => {
    const a = soak([vanillaMod], { seed: 9, turns: 300 });
    const b = soak([vanillaMod], { seed: 9, turns: 300 });
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.log).toEqual(b.log);
  });
});
