import { DIR_LIST, createRng, seedRng, type PlayerAction } from '@nh/core';

export function randomActions(n: number, seed: number): PlayerAction[] {
  const rng = createRng(seedRng(seed));
  const out: PlayerAction[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.rn2(10);
    if (r === 0) out.push({ type: 'wait' });
    else if (r === 1) out.push({ type: 'search' });
    else out.push({ type: 'move', dir: DIR_LIST[rng.rn2(8)] as (typeof DIR_LIST)[number] });
  }
  return out;
}
