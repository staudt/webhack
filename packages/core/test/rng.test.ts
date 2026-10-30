import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createRng, newRngStates, rnl, seedRng } from '../src/rng';

const GOLDEN: Record<number, number[]> = {
  42: [1028872839, 2516511472, 400437680, 853279530, 1920286840, 3588795744, 3644712829, 3990689672],
  0: [4205396811, 3543653536, 1222415357, 3047368389, 387095348, 2506032770, 735102004, 4023218824],
};

/** Independent minimal reference: splitmix32 -> sfc32, 12 warm-up steps. */
function refSequence(seed: number, n: number): number[] {
  let s = seed >>> 0;
  const sm = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = sm(), b = sm(), c = sm(), d = sm();
  const step = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) step();
  return Array.from({ length: n }, step);
}

const take = (n: number, f: () => number): number[] => Array.from({ length: n }, f);

describe('rng', () => {
  test.each([42, 0])('golden sequence for seed %i', (seed) => {
    const r = createRng(seedRng(seed));
    expect(take(8, () => r.next())).toEqual(GOLDEN[seed]);
    expect(refSequence(seed, 8)).toEqual(GOLDEN[seed]);
  });

  test('determinism', () => {
    const a = createRng(seedRng(7));
    const b = createRng(seedRng(7));
    expect(take(20, a.next)).toEqual(take(20, b.next));
  });

  test('serialization round-trip', () => {
    const st = seedRng(99);
    const r = createRng(st);
    take(5, r.next);
    const copy = JSON.parse(JSON.stringify(st)) as typeof st;
    const r2 = createRng(copy);
    expect(take(10, r.next)).toEqual(take(10, r2.next));
    expect(copy).toEqual(st);
  });

  test('mutates state in place with uint32 words', () => {
    const st = seedRng(1);
    const before = [...st];
    const r = createRng(st);
    r.next();
    expect(st).not.toEqual(before);
    for (const w of st) expect(Number.isInteger(w) && w >= 0 && w <= 0xffffffff).toBe(true);
  });

  test('rn2 stays in range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x100000000 }), fc.integer(), (x, seed) => {
        const v = createRng(seedRng(seed)).rn2(x);
        return Number.isInteger(v) && v >= 0 && v < x;
      }),
    );
  });

  test('rn2(2^32) returns raw word, rn2(1) is 0', () => {
    const r = createRng(seedRng(3));
    const ref = createRng(seedRng(3));
    expect(r.rn2(0x100000000)).toBe(ref.next());
    expect(r.rn2(1)).toBe(0);
  });

  test('rn2 rejection loop is exercised for huge x', () => {
    const r = createRng(seedRng(5));
    const x = 0x80000001 + 0x40000000; // ~37% rejection
    for (let i = 0; i < 2000; i++) expect(r.rn2(x)).toBeLessThan(x);
  });

  test('rn2(6) distribution', () => {
    const r = createRng(seedRng(2024));
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) counts[r.rn2(6)]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(9_500);
      expect(c).toBeLessThan(10_500);
    }
  });

  test('rnd and d ranges', () => {
    const r = createRng(seedRng(11));
    for (let i = 0; i < 500; i++) {
      const v = r.rnd(4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      const s = r.d(3, 6);
      expect(s).toBeGreaterThanOrEqual(3);
      expect(s).toBeLessThanOrEqual(18);
    }
    expect(r.d(0, 6)).toBe(0);
  });

  test('RangeError cases', () => {
    const r = createRng(seedRng(1));
    for (const x of [0, -1, 1.5, NaN, Infinity, 0x100000001, 2 ** 53]) {
      expect(() => r.rn2(x)).toThrow(RangeError);
    }
    expect(() => r.rnd(0)).toThrow(RangeError);
    expect(() => r.d(-1, 6)).toThrow(RangeError);
    expect(() => r.d(1.5, 6)).toThrow(RangeError);
    expect(() => r.d(2, 0)).toThrow(RangeError);
  });

  test('core and cosmetic streams differ', () => {
    const { core, cosmetic } = newRngStates(42);
    expect(core).toEqual(seedRng(42));
    expect(cosmetic).toEqual(seedRng((42 ^ 0x9e3779b9) >>> 0));
    expect(core).not.toEqual(cosmetic);
  });
});

describe('rnl (ref: src/rnd.c rnl)', () => {
  const counts = (x: number, luck: number, n = 20000): number[] => {
    const r = createRng(seedRng(7));
    const h = new Array<number>(x).fill(0);
    for (let i = 0; i < n; i++) {
      const v = rnl(r, x, luck);
      h[v] = (h[v] as number) + 1;
    }
    return h;
  };

  test('luck 0 is exactly rn2 (same stream)', () => {
    const a = createRng(seedRng(3));
    const b = createRng(seedRng(3));
    for (let i = 0; i < 200; i++) expect(rnl(a, 7)).toBe(b.rn2(7));
  });

  test('luck 0 distribution is roughly uniform', () => {
    for (const c of counts(7, 0)) expect(Math.abs(c - 20000 / 7)).toBeLessThan(300);
  });

  test('always within 0..x-1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: -13, max: 13 }),
        (seed, x, luck) => {
          const r = createRng(seedRng(seed));
          for (let i = 0; i < 20; i++) {
            const v = rnl(r, x, luck);
            if (!Number.isInteger(v) || v < 0 || v >= x) throw new Error(`out of range ${String(v)}`);
          }
        },
      ),
    );
  });

  test('good luck biases toward 0, bad luck toward x-1', () => {
    const good = counts(7, 13);
    const bad = counts(7, -13);
    expect(good[0] as number).toBeGreaterThan(20000 * 0.4);
    expect(bad[6] as number).toBeGreaterThan(20000 * 0.4);
    // luck 13 on x<=15 gives adjustment 4 (14/3): 0..4 collapse to 0 except the 1/41 unadjusted rolls
    expect(good[6] as number).toBeLessThan(good[0] as number);
  });

  test('small-range adjustment is luck/3 rounded away from 0', () => {
    // luck 1 -> adjustment 0 (no bias, same stream as rn2); luck 2 -> adjustment 1
    const a = createRng(seedRng(11));
    const b = createRng(seedRng(11));
    for (let i = 0; i < 100; i++) expect(rnl(a, 7, 1)).toBe(b.rn2(7));
    const c = counts(7, 2);
    expect(c[0] as number).toBeGreaterThan(20000 / 7 + 1000);
  });

  test('large ranges use the full luck as adjustment', () => {
    const r = createRng(seedRng(5));
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += rnl(r, 100, 10);
    expect(sum / 5000).toBeLessThan(45); // plain mean is 49.5; shifted down by ~10
  });

  test('rejects non-positive x', () => {
    expect(() => rnl(createRng(seedRng(1)), 0)).toThrow(RangeError);
  });
});
