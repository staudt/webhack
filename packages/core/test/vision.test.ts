import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { computeVisible, newMemory, updateMemory } from '../src/vision';
import { RULES, asciiLevel, idx, litAll } from './helpers/asciiLevel';

describe('computeVisible', () => {
  test('lit room: whole room incl. walls', () => {
    const l = litAll(asciiLevel(['#######', '#.....#', '#.....#', '#.....#', '#######']));
    l.cells = l.cells.map((c) => (c === 3 ? 1 : c));
    const v = computeVisible(l, RULES, { x: 3, y: 2 });
    expect(v.length).toBe(35);
  });
  test('dark room sees only adjacent 8 + self', () => {
    const l = asciiLevel(['|||||||', '|.....|', '|.....|', '|.....|', '|||||||']);
    const v = computeVisible(l, RULES, { x: 3, y: 2 });
    const exp = [];
    for (let y = 1; y <= 3; y++) for (let x = 2; x <= 4; x++) exp.push(idx(l, x, y));
    expect(v).toEqual(exp);
  });
  test('corridor sees only adjacent', () => {
    const l = asciiLevel(['         ', ' ####### ', '         ']);
    const v = computeVisible(l, RULES, { x: 3, y: 1 });
    expect(v).toContain(idx(l, 4, 1));
    expect(v).not.toContain(idx(l, 5, 1));
    expect(v.length).toBe(9);
  });
  test('pillar casts a shadow', () => {
    const l = litAll(asciiLevel(['.......', '.......', '.......', '.......', '.......']));
    l.cells[idx(l, 3, 2)] = 1;
    const v = computeVisible(l, RULES, { x: 1, y: 2 });
    expect(v).toContain(idx(l, 3, 2));
    expect(v).not.toContain(idx(l, 5, 2));
    expect(v).toContain(idx(l, 5, 0));
  });
  test('out-of-bounds origin gives nothing', () => {
    expect(computeVisible(asciiLevel(['.']), RULES, { x: 5, y: 5 })).toEqual([]);
  });
  test('sorted, unique, symmetric (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 9 }),
        fc.integer({ min: 3, max: 9 }),
        fc.array(fc.nat(100), { maxLength: 12 }),
        fc.nat(100),
        fc.nat(100),
        (w, h, pillars, ai, bi) => {
          const l = litAll(asciiLevel(Array.from({ length: h }, () => '.'.repeat(w))));
          for (const p of pillars) l.cells[p % (w * h)] = 1;
          const walls = new Set(pillars.map((p) => p % (w * h)));
          const open = [...Array(w * h).keys()].filter((i) => !walls.has(i));
          const a = open[ai % open.length];
          const b = open[bi % open.length];
          if (a === undefined || b === undefined) return;
          const pos = (i: number) => ({ x: i % w, y: Math.floor(i / w) });
          const va = computeVisible(l, RULES, pos(a));
          expect([...new Set(va)].sort((x, y) => x - y)).toEqual(va);
          const vb = computeVisible(l, RULES, pos(b));
          expect(va.includes(b)).toBe(vb.includes(a));
        },
      ),
      { numRuns: 300 },
    );
  });
  test('performance 250x250', () => {
    const rows: string[] = [];
    for (let y = 0; y < 250; y++)
      rows.push(y % 10 === 0 ? '-'.repeat(250) : '|' + '.'.repeat(248) + '|');
    const l = litAll(asciiLevel(rows));
    computeVisible(l, RULES, { x: 5, y: 5 });
    const t = Number(process.hrtime.bigint()) / 1e6;
    for (let i = 0; i < 10; i++) computeVisible(l, RULES, { x: 100, y: 15 });
    const per = (Number(process.hrtime.bigint()) / 1e6 - t) / 10;
    console.log(`vision 250x250: ${per.toFixed(2)} ms`);
    expect(per).toBeLessThan(25);
  });
});

describe('memory', () => {
  test('newMemory all -1; updateMemory reports changes', () => {
    const l = asciiLevel(['..', '..']);
    const m = newMemory(l);
    expect(m).toEqual([-1, -1, -1, -1]);
    expect(updateMemory(m, l, [3, 0, 1])).toEqual([0, 1, 3]);
    expect(m).toEqual([2, 2, -1, 2]);
    expect(updateMemory(m, l, [0, 1])).toEqual([]);
    l.cells[1] = 3;
    expect(updateMemory(m, l, [0, 1])).toEqual([1]);
    expect(m[1]).toBe(3);
  });
});
