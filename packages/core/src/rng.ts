import type { RngState } from './types/common';
import type { Rng } from './types/rng';

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function sfc32Step(s: RngState): number {
  let [a, b, c, d] = s;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a >>> 0;
  s[1] = b >>> 0;
  s[2] = c >>> 0;
  s[3] = d >>> 0;
  return t >>> 0;
}

/** Seed an sfc32 state from a number (splitmix32 expansion, 12 warm-up draws). */
export function seedRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const state: RngState = [sm(), sm(), sm(), sm()];
  for (let i = 0; i < 12; i++) sfc32Step(state);
  return state;
}

export function newRngStates(seed: number): { core: RngState; cosmetic: RngState } {
  return { core: seedRng(seed), cosmetic: seedRng((seed ^ 0x9e3779b9) >>> 0) };
}

/** Wrap a state array; every draw mutates it in place. */
export function createRng(state: RngState): Rng {
  const next = (): number => sfc32Step(state);
  // ref: src/rnd.c rn2()
  // Deviation (see DEVIATIONS.md): sfc32 with rejection sampling instead of NetHack's RND().
  const rn2 = (x: number): number => {
    if (!Number.isSafeInteger(x) || x < 1 || x > 0x100000000) {
      throw new RangeError(`rn2: x must be an integer in 1..2^32, got ${String(x)}`);
    }
    if (x === 0x100000000) return next();
    const limit = 0x100000000 - (0x100000000 % x);
    let r = next();
    while (r >= limit) r = next();
    return r % x;
  };
  // ref: src/rnd.c rnd()
  const rnd = (x: number): number => rn2(x) + 1;
  // ref: src/rnd.c d()
  const d = (n: number, s: number): number => {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`d: n must be a non-negative integer, got ${String(n)}`);
    }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rnd(s);
    return sum;
  };
  return { next, rn2, rnd, d };
}

/**
 * Luck-adjusted random number in 0..x-1: good luck pulls results toward 0, bad luck toward x-1.
 * ref: src/rnd.c rnl()
 */
export function rnl(rng: Rng, x: number, luck = 0): number {
  if (!Number.isSafeInteger(x) || x < 1) {
    throw new RangeError(`rnl: x must be a positive integer, got ${String(x)}`);
  }
  let adjustment = luck;
  if (x <= 15) {
    // for small ranges, use Luck/3 (rounded away from 0)
    adjustment = (Math.floor((Math.abs(adjustment) + 1) / 3)) * Math.sign(adjustment);
  }
  let i = rng.rn2(x);
  if (adjustment !== 0 && rng.rn2(37 + Math.abs(adjustment)) !== 0) {
    i -= adjustment;
    if (i < 0) i = 0;
    else if (i >= x) i = x - 1;
  }
  return i;
}
