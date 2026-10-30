import { vanillaMod } from '@nh/content';
import { createEngine, getLevel, getPlayer, type GameState } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { checkInvariants } from '../src/index';

const engine = createEngine([vanillaMod]);
const fresh = (): GameState => {
  const { state } = engine.newGame({ seed: 5 });
  engine.step(state, { type: 'wait' });
  return state;
};
const errs = (s: GameState): string[] => checkInvariants(s, engine.registry);

function wallCell(s: GameState): { x: number; y: number } {
  const l = getLevel(s);
  const wall = l.palette.indexOf('nh:vwall');
  const i = l.cells.indexOf(wall);
  return { x: i % l.width, y: Math.floor(i / l.width) };
}

describe('invariants', () => {
  test('a healthy state passes', () => {
    expect(errs(fresh())).toEqual([]);
  });

  test('out of bounds entity', () => {
    const s = fresh();
    const p = getPlayer(s).c.pos!;
    p.x = -1;
    expect(errs(s).join('\n')).toMatch(/out of bounds/);
  });

  test('entity on impassable cell', () => {
    const s = fresh();
    const w = wallCell(s);
    const p = getPlayer(s).c.pos!;
    p.x = w.x;
    p.y = w.y;
    expect(errs(s).join('\n')).toMatch(/impassable/);
  });

  test('two entities share a cell', () => {
    const s = fresh();
    const p = getPlayer(s);
    s.entities['99'] = { id: 99, def: p.def, c: { pos: { ...p.c.pos! } } };
    expect(errs(s).join('\n')).toMatch(/share cell/);
  });

  test('player missing / no actor / no pos', () => {
    let s = fresh();
    delete s.entities[String(s.playerId)];
    expect(errs(s).join('\n')).toMatch(/player entity .* missing/);
    s = fresh();
    delete getPlayer(s).c.actor;
    expect(errs(s).join('\n')).toMatch(/no actor/);
    s = fresh();
    delete getPlayer(s).c.pos;
    expect(errs(s).join('\n')).toMatch(/no pos/);
  });

  test('visible unsorted, duplicate or out of range', () => {
    let s = fresh();
    s.visible = [5, 3];
    expect(errs(s).join('\n')).toMatch(/ascending/);
    s = fresh();
    s.visible = [3, 3];
    expect(errs(s).join('\n')).toMatch(/ascending/);
    s = fresh();
    s.visible = [1e9];
    expect(errs(s).join('\n')).toMatch(/out of range/);
  });

  test('memory length and values', () => {
    let s = fresh();
    s.memory[s.currentLevel]!.pop();
    expect(errs(s).join('\n')).toMatch(/memory .* length/);
    s = fresh();
    s.memory[s.currentLevel]![0] = 999;
    expect(errs(s).join('\n')).toMatch(/memory .* out of range/);
  });

  test('palette index and array lengths', () => {
    let s = fresh();
    getLevel(s).cells[0] = 999;
    expect(errs(s).join('\n')).toMatch(/palette index 999/);
    s = fresh();
    getLevel(s).cells.pop();
    expect(errs(s).join('\n')).toMatch(/cells length/);
    s = fresh();
    getLevel(s).lit.pop();
    expect(errs(s).join('\n')).toMatch(/lit length/);
  });

  test('timers unsorted', () => {
    const s = fresh();
    s.timers = [
      { at: 5, seq: 1, kind: 'x:y', data: null },
      { at: 3, seq: 2, kind: 'x:y', data: null },
    ];
    expect(errs(s).join('\n')).toMatch(/timers not sorted/);
  });

  test('non-plain state', () => {
    const s = fresh();
    (s.modData as Record<string, unknown>)['x'] = new Map();
    expect(errs(s).join('\n')).toMatch(/JSON-plain/);
    const t = fresh();
    (t.modData as Record<string, unknown>)['x'] = undefined;
    (t as unknown as Record<string, unknown>)['fn'] = () => 1;
    expect(errs(t).join('\n')).toMatch(/JSON-plain/);
  });
});
