import { describe, expect, test } from 'vitest';
import { cellRules, checkStep } from '../src/movement';
import { loadMods } from '../src/registry';
import type { Mod, TerrainDef } from '../src/types/mod';
import type { DefId } from '../src/types/common';
import type { Level } from '../src/types/level';
import { RULES, asciiLevel } from './helpers/asciiLevel';

const reason = (l: Level, x: number, y: number, dir: Parameters<typeof checkStep>[3]) => {
  const r = checkStep(l, RULES, { x, y }, dir);
  return r.ok ? 'ok' : r.reason;
};

describe('checkStep', () => {
  const l = asciiLevel(['-----', '|...+', '|.o.|', '|.d.|', '-----']);
  test('ok / bounds / blocked', () => {
    expect(reason(l, 1, 1, 'e')).toBe('ok');
    expect(reason(l, 0, 0, 'n')).toBe('bounds');
    expect(reason(l, 4, 4, 'e')).toBe('bounds');
    expect(reason(l, 1, 1, 'w')).toBe('blocked');
  });
  test('closed door orthogonal', () => {
    expect(reason(l, 3, 1, 'e')).toBe('closedDoor');
  });
  test('diagonal into open door blocked, out of open door blocked', () => {
    expect(reason(l, 1, 1, 'se')).toBe('diagonalDoor');
    expect(reason(l, 2, 2, 'ne')).toBe('diagonalDoor');
    expect(reason(l, 2, 2, 'e')).toBe('ok');
  });
  test('locked door orthogonal: its own reason, and closedDoor stays set for travel', () => {
    const k = asciiLevel(['-----', '|...X', '|...|', '-----']);
    expect(reason(k, 3, 1, 'e')).toBe('lockedDoor');
    expect(RULES.closedDoor[9]).toBe(true);
    expect(reason(k, 3, 1, 'se')).toBe('blocked'); // wall, not the door
  });
  test('diagonal into/out of a locked door is still a diagonal door', () => {
    const k = asciiLevel(['...', '.X.', '...']);
    expect(reason(k, 0, 0, 'se')).toBe('diagonalDoor');
    expect(reason(k, 1, 1, 'se')).toBe('diagonalDoor');
  });
  test('diagonal into/out of closed door blocked', () => {
    expect(reason(l, 3, 2, 'ne')).toBe('diagonalDoor');
    const c = asciiLevel(['...', '.+.', '...']);
    expect(reason(c, 0, 0, 'se')).toBe('diagonalDoor');
    expect(reason(c, 1, 1, 'se')).toBe('diagonalDoor');
  });
  test('diagonal through doorway allowed', () => {
    expect(reason(l, 1, 2, 'se')).toBe('ok');
    expect(reason(l, 2, 3, 'nw')).toBe('ok');
  });
  test('squeezing between walls allowed', () => {
    const s = asciiLevel(['.|', '|.']);
    expect(reason(s, 0, 0, 'se')).toBe('ok');
  });
});

describe('cellRules from registry', () => {
  const t = (name: string, extra: Partial<TerrainDef>): TerrainDef => ({
    id: `t:${name}` as DefId,
    nameKey: name,
    passable: true,
    opaque: false,
    glyph: { ch: '.', fg: '#fff' },
    ...extra,
  });
  const m: Mod = {
    id: 't',
    version: '1',
    register(api) {
      api.defineTerrain(t('floor', {}));
      api.defineTerrain(t('wall', { passable: false, opaque: true }));
      api.defineTerrain(t('dc', { passable: false, opaque: true, door: 'closed' }));
      api.defineTerrain(t('dl', { passable: false, opaque: true, door: 'locked' }));
      api.defineTerrain(t('do', { door: 'open' }));
      api.defineTerrain(t('dw', { door: 'doorway' }));
    },
  };
  test('maps flags by palette order', () => {
    const reg = loadMods([m]);
    const level = asciiLevel(['.']);
    level.palette = ['t:dw', 't:wall', 't:do', 't:dc', 't:floor'] as DefId[];
    const r = cellRules(level, reg);
    expect(r.passable).toEqual([true, false, true, false, true]);
    expect(r.opaque).toEqual([false, true, false, true, false]);
    expect(r.closedDoor).toEqual([false, false, false, true, false]);
    expect(r.intactDoor).toEqual([false, false, true, true, false]);
    expect(r.lockedDoor).toEqual([false, false, false, false, false]);
  });
  test('a locked door is closed, locked and intact', () => {
    const level = asciiLevel(['.']);
    level.palette = ['t:dl', 't:dc'] as DefId[];
    const r = cellRules(level, loadMods([m]));
    expect(r.closedDoor).toEqual([true, true]);
    expect(r.lockedDoor).toEqual([true, false]);
    expect(r.intactDoor).toEqual([true, true]);
  });
});
