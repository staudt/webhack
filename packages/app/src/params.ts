export interface Params {
  seed: number;
  width: number;
  height: number;
  /** `new=1`: ignore any save. */
  forceNew: boolean;
  /** URL explicitly names a seed or size, so a new game is wanted. */
  explicit: boolean;
}

export const DEFAULT_W = 80;
export const DEFAULT_H = 21;

const clampSize = (raw: string | null, def: number): number => {
  if (raw === null || !/^\d+$/.test(raw.trim())) return def;
  return Math.min(1000, Math.max(10, Number(raw)));
};

export function parseParams(search: string, randomSeed: () => number): Params {
  const q = new URLSearchParams(search);
  const rawSeed = q.get('seed');
  const seedOk = rawSeed !== null && /^\d+$/.test(rawSeed.trim()) && Number(rawSeed) <= 0xffffffff;
  const seed = seedOk ? Number(rawSeed) : randomSeed();
  return {
    seed,
    width: clampSize(q.get('w'), DEFAULT_W),
    height: clampSize(q.get('h'), DEFAULT_H),
    forceNew: q.get('new') === '1',
    explicit: seedOk || q.has('w') || q.has('h'),
  };
}
