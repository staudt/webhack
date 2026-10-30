import { describe, expect, test } from 'vitest';
import type { GameState } from '../src/types/state';
import { DIRS, DIR_LIST, cellIndex, inBounds, sortedIds } from '../src/util';

describe('util', () => {
  test('sortedIds sorts numerically', () => {
    const state = { entities: { '2': {}, '10': {}, '1': {} } } as unknown as GameState;
    expect(sortedIds(state)).toEqual([1, 2, 10]);
  });

  test('DIRS / DIR_LIST', () => {
    expect(DIR_LIST).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
    expect(DIRS.n).toEqual({ x: 0, y: -1 });
    expect(DIRS.e).toEqual({ x: 1, y: 0 });
    expect(DIRS.se).toEqual({ x: 1, y: 1 });
    expect(DIRS.sw).toEqual({ x: -1, y: 1 });
    expect(DIRS.w).toEqual({ x: -1, y: 0 });
    expect(DIRS.nw).toEqual({ x: -1, y: -1 });
    expect(DIRS.ne).toEqual({ x: 1, y: -1 });
    expect(DIRS.s).toEqual({ x: 0, y: 1 });
  });

  test('cellIndex / inBounds', () => {
    const lv = { width: 80, height: 21 };
    expect(cellIndex(lv, 0, 0)).toBe(0);
    expect(cellIndex(lv, 3, 2)).toBe(163);
    expect(inBounds(lv, 0, 0)).toBe(true);
    expect(inBounds(lv, 79, 20)).toBe(true);
    expect(inBounds(lv, -1, 0)).toBe(false);
    expect(inBounds(lv, 0, -1)).toBe(false);
    expect(inBounds(lv, 80, 0)).toBe(false);
    expect(inBounds(lv, 0, 21)).toBe(false);
  });
});
