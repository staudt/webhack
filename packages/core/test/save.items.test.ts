import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { isJsonPlain, stateHash } from '../src/hash';
import { SAVE_VERSION } from '../src/save';
import { actionsMod, terrainMod } from './helpers/fakeMods';
import { addItem, heroPos, objectsMod } from './helpers/objectMods';

const engine = createEngine([terrainMod(), actionsMod(), objectsMod()]);

describe('save with items', () => {
  test('new game is version 5 with empty object state', () => {
    const { state } = engine.newGame({ seed: 3, width: 40, height: 15 });
    expect(SAVE_VERSION).toBe(5);
    expect(state.version).toBe(5);
    // refreshVision creates the current level's (empty) entry.
    expect(state.objectMemory).toEqual({ dlvl1: {} });
    expect(state.appearances).toEqual({});
    expect(state.discovered).toEqual([]);
    expect(isJsonPlain(state)).toBe(true);
  });

  test('round trip keeps items, memory, appearances and discoveries', () => {
    const { state } = engine.newGame({ seed: 3, width: 40, height: 15 });
    state.appearances['ob:pot_a'] = 'ob:ruby';
    state.discovered.push('ob:dagger');
    const floor = addItem(state, 'ob:pot_a', { pos: heroPos(state), placed: 4, quantity: 2 });
    const mine = addItem(state, 'ob:dagger', {
      carriedBy: state.playerId,
      letter: 'a',
      equipped: 'weapon',
    });
    state.entities[String(floor)]!.c.item!.corpseOf = 'ob:apple';
    engine.step(state, { type: 'wait' });
    expect(Object.keys(state.objectMemory)).toHaveLength(1);
    expect(isJsonPlain(state)).toBe(true);
    const replay = { seed: 3, width: 40, height: 15, mods: [], actions: [] };
    const loaded = engine.load(engine.save(state, replay));
    expect(stateHash(loaded.state)).toBe(stateHash(state));
    expect(loaded.state.entities[String(mine)]?.c.item?.equipped).toBe('weapon');
    expect(loaded.state.entities[String(floor)]?.c.item).toMatchObject({
      quantity: 2,
      placed: 4,
      corpseOf: 'ob:apple',
    });
    expect(loaded.state.objectMemory).toEqual(state.objectMemory);
    expect(loaded.state.appearances).toEqual({ 'ob:pot_a': 'ob:ruby' });
    expect(loaded.state.discovered).toEqual(['ob:dagger']);
  });

  test('older save versions are rejected', () => {
    const { state } = engine.newGame({ seed: 3, width: 40, height: 15 });
    const o = JSON.parse(
      engine.save(state, { seed: 3, width: 40, height: 15, mods: [], actions: [] }),
    ) as { version: number };
    o.version = 2;
    expect(() => engine.load(JSON.stringify(o))).toThrow(/Unsupported save version 2/);
  });
});
