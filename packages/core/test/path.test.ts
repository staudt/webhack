import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { checkStep } from '../src/movement';
import { findPath } from '../src/path';
import type { Dir } from '../src/types/action';
import type { Level } from '../src/types/level';
import { DIRS, DIR_LIST } from '../src/util';
import { RULES, asciiLevel } from './helpers/asciiLevel';

const full = (l: Level) => [...l.cells];
const P = (x: number, y: number) => ({ x, y });

describe('findPath', () => {
  test('straight line', () => {
    const l = asciiLevel(['.....']);
    expect(findPath(l, RULES, full(l), P(0, 0), P(3, 0))).toEqual([P(1, 0), P(2, 0), P(3, 0)]);
  });
  test('from === to', () => {
    const l = asciiLevel(['..']);
    expect(findPath(l, RULES, full(l), P(1, 0), P(1, 0))).toEqual([]);
  });
  test('around a wall', () => {
    const l = asciiLevel(['.|.', '.|.', '...']);
    const p = findPath(l, RULES, full(l), P(0, 0), P(2, 0));
    expect(p?.length).toBe(4);
    expect(p?.at(-1)).toEqual(P(2, 0));
  });
  test('diagonal-door rule forces orthogonal entry', () => {
    const l = asciiLevel(['...', '.o.', '...']);
    // (0,0)->(2,2) must not step through the door diagonally
    const p = findPath(l, RULES, full(l), P(0, 0), P(2, 2));
    expect(p?.length).toBe(3);
    expect(p).not.toContainEqual(P(1, 1));
    const l2 = asciiLevel(['|.|', '|d|', '|.|']);
    expect(findPath(l2, RULES, full(l2), P(1, 0), P(1, 2))?.length).toBe(2);
    const l3 = asciiLevel(['-----', '|.o.|', '-----']);
    expect(findPath(l3, RULES, full(l3), P(1, 1), P(3, 1))?.length).toBe(2);
  });
  test('closed doors are traversable', () => {
    const l = asciiLevel(['.+.']);
    expect(findPath(l, RULES, full(l), P(0, 0), P(2, 0))?.length).toBe(2);
  });
  test('unknown cells not used', () => {
    const l = asciiLevel(['...', '...', '...']);
    const m = full(l);
    m[1] = -1;
    m[4] = -1;
    m[7] = -1;
    expect(findPath(l, RULES, m, P(0, 0), P(2, 0))).toBeNull();
    expect(findPath(l, RULES, m, P(0, 0), P(1, 1))).toBeNull();
  });
  test('unreachable / impassable / out of bounds', () => {
    const l = asciiLevel(['.|.', '...']);
    expect(findPath(l, RULES, full(l), P(0, 0), P(1, 0))).toBeNull();
    expect(findPath(l, RULES, full(l), P(0, 0), P(9, 9))).toBeNull();
    expect(findPath(l, RULES, full(l), P(-1, 0), P(0, 0))).toBeNull();
    const w = asciiLevel(['.|.', '|||']);
    expect(findPath(w, RULES, full(w), P(0, 0), P(2, 0))).toBeNull();
  });
  test('deterministic', () => {
    const l = asciiLevel(['.....', '.....', '.....', '.....']);
    const a = findPath(l, RULES, full(l), P(0, 0), P(4, 3));
    expect(findPath(l, RULES, full(l), P(0, 0), P(4, 3))).toEqual(a);
    expect(a?.length).toBe(4);
  });
  test('perf 200x200 open', () => {
    const l = asciiLevel(Array.from({ length: 200 }, () => '.'.repeat(200)));
    const m = full(l);
    const t = Number(process.hrtime.bigint()) / 1e6;
    const p = findPath(l, RULES, m, P(0, 0), P(199, 199));
    const ms = Number(process.hrtime.bigint()) / 1e6 - t;
    console.log(`path 200x200: ${ms.toFixed(2)} ms`);
    expect(p?.length).toBe(199);
    const t2 = Number(process.hrtime.bigint()) / 1e6;
    findPath(l, RULES, m, P(0, 0), P(199, 5));
    expect(Number(process.hrtime.bigint()) / 1e6 - t2).toBeLessThan(200);
  });
  test('every step is legal (property)', () => {
    const chars = fc.constantFrom('.', '.', '.', '|', '+', 'o', 'd', '#');
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: chars, minLength: 7, maxLength: 7 }), {
          minLength: 7,
          maxLength: 7,
        }),
        fc.nat(48),
        fc.nat(48),
        (rows, a, b) => {
          const l = asciiLevel(rows);
          const from = P(a % 7, Math.floor(a / 7));
          const to = P(b % 7, Math.floor(b / 7));
          const p = findPath(l, RULES, full(l), from, to);
          if (!p) return;
          let cur = from;
          for (const s of p) {
            const dir = DIR_LIST.find(
              (d: Dir) => DIRS[d].x === s.x - cur.x && DIRS[d].y === s.y - cur.y,
            );
            expect(dir).toBeDefined();
            const r = checkStep(l, RULES, cur, dir as Dir);
            expect(r.ok || r.reason === 'closedDoor').toBe(true);
            cur = s;
          }
          expect(cur).toEqual(to);
        },
      ),
      { numRuns: 300 },
    );
  });
});
