import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createRng, newRngStates } from '../src/rng';
import { generateLevel, VANILLA_TERRAIN } from '../src/levelgen/index';
import { PAL } from '../src/levelgen/terrain';
import type { Level } from '../src/types/level';

const seedArb = fc.integer({ min: 0, max: 2 ** 32 - 1 });
const smallSize = fc.record({
  w: fc.integer({ min: 10, max: 120 }),
  h: fc.integer({ min: 10, max: 40 }),
});
const bigSize = fc.record({
  w: fc.integer({ min: 120, max: 250 }),
  h: fc.integer({ min: 100, max: 250 }),
});
const depthArb = fc.integer({ min: 1, max: 40 });

function gen(seed: number, w: number, h: number, depth: number): Level {
  return generateLevel(createRng(newRngStates(seed).core), {
    id: 'p',
    depth,
    width: w,
    height: h,
    terrain: VANILLA_TERRAIN,
  });
}

const PASSABLE = new Set<number>([
  PAL.floor,
  PAL.corr,
  PAL.doorway,
  PAL.door_open_v,
  PAL.door_open_h,
  PAL.door_closed,
  PAL.stairs_up,
  PAL.stairs_down,
  // secret doors and corridors can be found by searching, so they count for connectivity
  PAL.sdoor_v,
  PAL.sdoor_h,
  PAL.scorr,
]);
const DOORS = new Set<number>([PAL.doorway, PAL.door_open_v, PAL.door_open_h, PAL.door_closed]);
const WALLS = new Set<number>([
  PAL.vwall,
  PAL.hwall,
  PAL.tlcorn,
  PAL.trcorn,
  PAL.blcorn,
  PAL.brcorn,
]);

const at = (l: Level, x: number, y: number): number =>
  x < 0 || y < 0 || x >= l.width || y >= l.height
    ? PAL.stone
    : (l.cells[y * l.width + x] as number);

/** 4-connected flood fill over passable cells from (sx, sy). */
function reach(l: Level, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(l.width * l.height);
  const stack = [sy * l.width + sx];
  seen[stack[0] as number] = 1;
  while (stack.length) {
    const c = stack.pop() as number;
    const x = c % l.width;
    const y = (c - x) / l.width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= l.width || ny >= l.height) continue;
      const ni = ny * l.width + nx;
      if (!seen[ni] && PASSABLE.has(l.cells[ni] as number)) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return seen;
}

function checkLevel(l: Level, w: number, h: number): void {
  // structure
  expect(l.cells.length).toBe(w * h);
  expect(l.lit.length).toBe(w * h);
  expect(l.palette.length).toBe(18);
  for (const c of l.cells) {
    if (!(Number.isInteger(c) && c >= 0 && c < l.palette.length))
      throw new Error('bad palette index');
  }
  for (const v of l.lit) if (v !== 0 && v !== 1) throw new Error('bad lit');
  expect(l.rooms.length).toBeGreaterThan(0);

  // rooms: in bounds, floor inside, enclosed by non-stone
  for (const r of l.rooms) {
    if (r.lx < 1 || r.ly < 1 || r.hx > w - 2 || r.hy > h - 2) throw new Error('room out of bounds');
    for (let y = r.ly - 1; y <= r.hy + 1; y++) {
      for (let x = r.lx - 1; x <= r.hx + 1; x++) {
        const t = at(l, x, y);
        const interior = x >= r.lx && x <= r.hx && y >= r.ly && y <= r.hy;
        if (interior) {
          if (t === PAL.stone || WALLS.has(t) || DOORS.has(t)) throw new Error('bad room interior');
        } else if (t === PAL.stone) {
          throw new Error('room not enclosed');
        }
      }
    }
  }

  // doors have walls on two opposite sides
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!DOORS.has(at(l, x, y))) continue;
      const horiz = WALLS.has(at(l, x - 1, y)) && WALLS.has(at(l, x + 1, y));
      const vert = WALLS.has(at(l, x, y - 1)) && WALLS.has(at(l, x, y + 1));
      if (!horiz && !vert) throw new Error(`door at ${String(x)},${String(y)} lacks walls`);
      if (at(l, x, y) === PAL.door_open_v && !vert) throw new Error('open_v not in vertical wall');
      if (at(l, x, y) === PAL.door_open_h && !horiz)
        throw new Error('open_h not in horizontal wall');
    }
  }

  // secret doors sit in a wall line like regular doors, and only below depth 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(l, x, y);
      if (t === PAL.sdoor_v && !(WALLS.has(at(l, x, y - 1)) && WALLS.has(at(l, x, y + 1))))
        throw new Error(`sdoor_v at ${String(x)},${String(y)} not in a vertical wall line`);
      if (t === PAL.sdoor_h && !(WALLS.has(at(l, x - 1, y)) && WALLS.has(at(l, x + 1, y))))
        throw new Error(`sdoor_h at ${String(x)},${String(y)} not in a horizontal wall line`);
      if ((t === PAL.sdoor_v || t === PAL.sdoor_h || t === PAL.scorr) && l.depth <= 2)
        throw new Error('secret door or corridor above depth 3');
    }
  }

  // connectivity
  const first = l.rooms[0] as (typeof l.rooms)[number];
  const seen = reach(l, first.lx, first.ly);
  for (const r of l.rooms) {
    for (let y = r.ly; y <= r.hy; y++)
      for (let x = r.lx; x <= r.hx; x++)
        if (!seen[y * w + x]) throw new Error('room interior unreachable');
  }

  // stairs
  const { up, down } = l;
  if (!up || !down) throw new Error('missing stairs');
  expect(up.x === down.x && up.y === down.y).toBe(false);
  expect(at(l, up.x, up.y)).toBe(PAL.stairs_up);
  expect(at(l, down.x, down.y)).toBe(PAL.stairs_down);
  for (const p of [up, down]) {
    const room = l.rooms.find((r) => p.x >= r.lx && p.x <= r.hx && p.y >= r.ly && p.y <= r.hy);
    if (!room) throw new Error('stairs outside rooms');
    if (!seen[p.y * w + p.x]) throw new Error('stairs unreachable');
  }
  let stairCount = 0;
  for (const c of l.cells) if (c === PAL.stairs_up || c === PAL.stairs_down) stairCount++;
  expect(stairCount).toBe(2);
}

describe('levelgen properties', () => {
  test('small and medium maps', () => {
    fc.assert(
      fc.property(seedArb, smallSize, depthArb, (seed, { w, h }, depth) => {
        checkLevel(gen(seed, w, h, depth), w, h);
      }),
      { numRuns: 300 },
    );
  });

  test('vanilla size', () => {
    fc.assert(
      fc.property(seedArb, depthArb, (seed, depth) => {
        checkLevel(gen(seed, 80, 21, depth), 80, 21);
      }),
      { numRuns: 300 },
    );
  });

  test('large maps', () => {
    fc.assert(
      fc.property(seedArb, bigSize, (seed, { w, h }) => {
        checkLevel(gen(seed, w, h, 3), w, h);
      }),
      { numRuns: 12 },
    );
  });

  test('secret doors and corridors do appear below depth 2', () => {
    let doors = 0;
    let corrs = 0;
    for (let seed = 0; seed < 40; seed++) {
      const l = gen(seed, 80, 21, 5);
      for (const c of l.cells) {
        if (c === PAL.sdoor_v || c === PAL.sdoor_h) doors++;
        if (c === PAL.scorr) corrs++;
      }
    }
    expect(doors).toBeGreaterThan(0);
    expect(corrs).toBeGreaterThan(0);
  });

  test('determinism', () => {
    fc.assert(
      fc.property(seedArb, smallSize, depthArb, (seed, { w, h }, depth) => {
        expect(gen(seed, w, h, depth)).toEqual(gen(seed, w, h, depth));
      }),
      { numRuns: 60 },
    );
  });
});
