import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { getPlayer } from '../src/state';
import type { EntityId } from '../src/types/common';
import type { Mod } from '../src/types/mod';
import { actionsMod, terrainMod } from './helpers/fakeMods';

const calls: EntityId[] = [];
const roleMod = (movement?: () => number): Mod => ({
  id: 'rl',
  version: '1',
  register: (api) =>
    api.defineRole({
      id: 'rl:hero',
      nameKey: 'role.rl',
      speed: 12,
      glyph: { ch: '@', fg: '#fff' },
      ...(movement
        ? {
            movement: (_ctx, hero) => {
              calls.push(hero);
              return movement();
            },
          }
        : {}),
    }),
});
const turnsFor = (movement?: () => number, waits = 4): { turns: number; hero: EntityId } => {
  const e = createEngine([terrainMod([]), actionsMod(), roleMod(movement)]);
  const s = e.newGame({ seed: 5, width: 40, height: 15 }).state;
  const t0 = s.turn;
  for (let i = 0; i < waits; i++) e.step(s, { type: 'wait' });
  expect(getPlayer(s).def).toBe('rl:hero');
  return { turns: s.turn - t0, hero: s.playerId };
};

describe('RoleDef.movement', () => {
  test('without it, actor speed is the gain: one turn per action', () => {
    calls.length = 0;
    expect(turnsFor().turns).toBe(4);
    expect(calls).toEqual([]);
  });

  test('movement 6 makes the hero act every other turn', () => {
    calls.length = 0;
    const r = turnsFor(() => 6);
    expect(r.turns).toBe(8);
    expect(calls).toHaveLength(8);
    expect(calls.every((c) => c === r.hero)).toBe(true);
  });

  test('movement 24 gives extra actions per turn', () => {
    expect(turnsFor(() => 24, 4).turns).toBe(2);
  });
});
