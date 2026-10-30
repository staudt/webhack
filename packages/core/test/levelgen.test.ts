import { describe, expect, test } from 'vitest';
import { createRng, newRngStates } from '../src/rng';
import {
  generateLevel,
  levelToAscii,
  VANILLA_TERRAIN,
  MIN_LEVEL_HEIGHT,
  MIN_LEVEL_WIDTH,
} from '../src/levelgen/index';
import { PAL } from '../src/levelgen/terrain';
import { Grid, T } from '../src/levelgen/grid';
import { RectList, type NhRect } from '../src/levelgen/rect';
import { addRoom, litstateRnd, makeRooms, sortRooms, maxRooms } from '../src/levelgen/rooms';
import { dodoor, digCorridor, ensureConnected, finddpos, okdoor } from '../src/levelgen/corridors';
import type { Level } from '../src/types/level';

export function gen(seed: number, width = 80, height = 21, depth = 1): Level {
  return generateLevel(createRng(newRngStates(seed).core), {
    id: 'test',
    depth,
    width,
    height,
    terrain: VANILLA_TERRAIN,
  });
}

describe('levelgen', () => {
  test('seed 1, 80x21 snapshot', () => {
    const lvl = gen(1);
    expect(levelToAscii(lvl)).toMatchSnapshot();
  });

  test('deterministic and seed-sensitive', () => {
    expect(JSON.stringify(gen(5))).toBe(JSON.stringify(gen(5)));
    expect(JSON.stringify(gen(5))).not.toBe(JSON.stringify(gen(6)));
  });

  test('palette follows terrain key order', () => {
    const lvl = gen(2);
    expect(lvl.palette).toEqual(Object.values(VANILLA_TERRAIN));
    expect(lvl.palette[PAL.door_open_v]).toBe('nh:door_open_v');
  });

  test('lit rooms light their walls and interior', () => {
    let checked = 0;
    for (let seed = 0; seed < 10; seed++) {
      const lvl = gen(seed);
      for (const r of lvl.rooms.filter((q) => q.lit)) {
        for (let y = r.ly - 1; y <= r.hy + 1; y++)
          for (let x = r.lx - 1; x <= r.hx + 1; x++) {
            expect(lvl.lit[y * lvl.width + x]).toBe(1);
            checked++;
          }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('deep levels are mostly dark', () => {
    const lit = (d: number): number =>
      [...Array(20).keys()].reduce(
        (n, s) => n + gen(s, 80, 21, d).rooms.filter((r) => r.lit).length,
        0,
      );
    expect(lit(60)).toBeLessThan(lit(1));
  });

  test('too-small and non-integer sizes throw', () => {
    const rng = createRng(newRngStates(1).core);
    const o = { id: 'x', depth: 1, terrain: VANILLA_TERRAIN };
    expect(() => generateLevel(rng, { ...o, width: MIN_LEVEL_WIDTH - 1, height: 21 })).toThrow(
      RangeError,
    );
    expect(() => generateLevel(rng, { ...o, width: 80, height: MIN_LEVEL_HEIGHT - 1 })).toThrow(
      RangeError,
    );
    expect(() => generateLevel(rng, { ...o, width: 80.5, height: 21 })).toThrow(RangeError);
  });

  test('minimum size works', () => {
    for (let s = 0; s < 20; s++) {
      expect(gen(s, MIN_LEVEL_WIDTH, MIN_LEVEL_HEIGHT).rooms.length).toBeGreaterThan(0);
    }
  });

  test('door and stair glyphs appear', () => {
    const all = [...Array(30).keys()].map((s) => levelToAscii(gen(s, 80, 21, 5))).join('\n');
    for (const ch of ['+', '<', '>', '#', '|', '-', '.']) expect(all).toContain(ch);
  });

  test('250x250 fills up with rooms', () => {
    const lvl = gen(3, 250, 250);
    expect(lvl.rooms.length).toBeGreaterThan(40);
  });

  test('retry exhaustion throws', () => {
    // An rng whose rn2 always yields the maximum makes every room attempt fail on a tiny map.
    const bad = { next: () => 0, rn2: (x: number) => x - 1, rnd: (x: number) => x, d: () => 1 };
    expect(() =>
      generateLevel(bad, { id: 'x', depth: 1, width: 10, height: 10, terrain: VANILLA_TERRAIN }),
    ).toThrow(/no rooms/);
  });
});

describe('levelgen internals', () => {
  const rng = (seed: number) => createRng(newRngStates(seed).core);

  test('litstate and maxRooms', () => {
    expect(typeof litstateRnd(rng(1), 1)).toBe('boolean');
    expect(maxRooms(80, 21)).toBe(40);
    expect(maxRooms(250, 250)).toBeGreaterThan(1000);
  });

  test('rect list split and bookkeeping', () => {
    const rl = new RectList(81, 21);
    expect(rl.rnd(rng(1))).not.toBeNull();
    const first = rl.toArray()[0] as NhRect;
    rl.split(first, { lx: 20, ly: 5, hx: 30, hy: 10 });
    expect(rl.size).toBeGreaterThan(1);
    expect(rl.find({ lx: 22, ly: 6, hx: 28, hy: 9 })).toBeNull();
    const before = rl.size;
    rl.add(rl.toArray()[0] as NhRect); // duplicate: ignored
    expect(rl.size).toBe(before);
    rl.remove({ lx: -9, ly: -9, hx: -9, hy: -9 }); // unknown: ignored
    expect(rl.size).toBe(before);
    for (let i = 0; i < 100; i++) rl.add({ lx: i * 2, ly: 0, hx: i * 2, hy: 0 }); // capped
    expect(rl.size).toBeLessThanOrEqual(Math.floor((81 * 21) / 30));
    const tiny = new RectList(11, 10);
    tiny.remove(tiny.toArray()[0] as NhRect);
    expect(tiny.size).toBe(0);
    expect(tiny.rnd(rng(1))).toBeNull();
  });

  test('ensureConnected repairs a level without corridors', () => {
    let repaired = 0;
    for (let seed = 0; seed < 12; seed++) {
      const g = new Grid(80, 21);
      const r = rng(seed);
      makeRooms(g, r, 1, maxRooms(80, 21));
      sortRooms(g);
      if (g.rooms.length < 2) continue;
      ensureConnected(g);
      repaired++;
      // every room interior reachable from the first
      const seen = new Set<number>();
      const stack = [g.idx((g.rooms[0] as { lx: number }).lx, (g.rooms[0] as { ly: number }).ly)];
      while (stack.length) {
        const c = stack.pop() as number;
        if (seen.has(c)) continue;
        seen.add(c);
        const x = c % g.colno;
        const y = (c - x) / g.colno;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const t = g.get(x + dx, y + dy);
          if (t === T.DOOR || t === T.CORR || t === T.ROOM) stack.push(g.idx(x + dx, y + dy));
        }
      }
      for (const room of g.rooms) expect(seen.has(g.idx(room.lx, room.ly))).toBe(true);
    }
    expect(repaired).toBeGreaterThan(0);
  });

  test('ensureConnected throws when walled in', () => {
    const g = new Grid(30, 12);
    addRoom(g, 3, 2, 6, 4, false);
    addRoom(g, 20, 2, 23, 4, false);
    // block the space between with a full-height wall of walls
    for (let y = 0; y < 12; y++) g.set(12, y, T.VWALL);
    expect(() => ensureConnected(g)).toThrow(/unable to connect/);
  });

  test('door and corridor helpers', () => {
    const g = new Grid(30, 12);
    addRoom(g, 3, 2, 6, 4, false);
    const r = rng(3);
    const room = g.rooms[0] as (typeof g.rooms)[number];
    for (const dir of ['N', 'S', 'E', 'W'] as const)
      expect(finddpos(g, r, dir, room)).not.toBeNull();
    const p = finddpos(g, r, 'E', room) as { x: number; y: number };
    expect(okdoor(g, p.x, p.y)).toBe(true);
    dodoor(g, r, 1, p.x, p.y);
    expect(g.get(p.x, p.y)).toBe(T.DOOR);
    expect(okdoor(g, p.x, p.y)).toBe(false);
    dodoor(g, r, 10, p.x, p.y); // re-doing an existing door keeps it a door
    expect(g.get(p.x, p.y)).toBe(T.DOOR);
    // no usable wall cells on the west edge
    for (let y = room.ly; y <= room.hy; y++) g.set(room.lx - 1, y, T.STONE);
    expect(finddpos(g, r, 'W', room)).toBeNull();
    // bad digging coordinates
    expect(digCorridor(g, r, { x: 0, y: 1 }, { x: 5, y: 5 }, false, 500).ok).toBe(false);
    expect(digCorridor(g, r, { x: 5, y: 5 }, { x: 5, y: 99 }, false, 500).ok).toBe(false);
    expect(digCorridor(g, r, { x: 12, y: 8 }, { x: 12, y: 9 }, false, 500).ok).toBe(true);
    // digging into a wall fails
    expect(digCorridor(g, r, { x: 8, y: 3 }, { x: 4, y: 3 }, false, 500).ok).toBe(false);
    // step limit
    expect(digCorridor(g, r, { x: 10, y: 8 }, { x: 28, y: 9 }, false, 2).ok).toBe(false);
  });
});
