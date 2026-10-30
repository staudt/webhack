import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { stateHash } from '../src/hash';
import { SAVE_FORMAT, SAVE_VERSION } from '../src/save';
import type { Replay } from '../src/types/protocol';
import { actionsMod, costAction, terrainMod } from './helpers/fakeMods';

const mods = () => [terrainMod(), actionsMod()];
const engine = createEngine(mods());
const replay = (seed: number): Replay => ({ seed, width: 40, height: 15, mods: [], actions: [] });
const fresh = () => engine.newGame({ seed: 11, width: 40, height: 15 }).state;
const mutate = (f: (o: Record<string, unknown>) => void): string => {
  const o = JSON.parse(engine.save(fresh(), replay(11))) as Record<string, unknown>;
  f(o);
  return JSON.stringify(o);
};

describe('save/load', () => {
  test('round trip, then both continue identically', () => {
    const a = fresh();
    for (let i = 0; i < 10; i++) engine.step(a, i % 2 ? { type: 'wait' } : costAction(20));
    const rp = replay(11);
    const loaded = engine.load(engine.save(a, rp));
    expect(stateHash(loaded.state)).toBe(stateHash(a));
    expect(loaded.replay).toEqual(rp);
    for (let i = 0; i < 10; i++) {
      const act = i % 2 ? costAction(12) : { type: 'wait' as const };
      const ea = engine.step(a, act).events;
      const eb = engine.step(loaded.state, act).events;
      expect(eb).toEqual(ea);
    }
    expect(stateHash(loaded.state)).toBe(stateHash(a));
  });

  test('invalid JSON keeps the cause', () => {
    try {
      engine.load('{nope');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/not valid JSON/);
      expect((e as Error).cause).toBeInstanceOf(SyntaxError);
    }
  });

  test('valid JSON that is not an object', () => {
    expect(() => engine.load('null')).toThrow('Not a nh-ts save file');
  });

  test('wrong format', () => {
    expect(() => engine.load(mutate((o) => (o['format'] = 'other')))).toThrow(`Not a ${SAVE_FORMAT} save`);
  });

  test('wrong version', () => {
    expect(() => engine.load(mutate((o) => (o['version'] = 99)))).toThrow(
      `Unsupported save version 99 (expected ${SAVE_VERSION})`,
    );
  });

  test.each(['state', 'replay', 'mods'])('missing %s', (k) => {
    expect(() => engine.load(mutate((o) => delete o[k]))).toThrow('missing state, replay or mods');
  });

  test('empty saved mod list prints (none)', () => {
    expect(() => engine.load(mutate((o) => (o['mods'] = [])))).toThrow('mods [(none)]');
  });

  test('mod list mismatch lists both sides', () => {
    const other = createEngine([terrainMod(), actionsMod(), { id: 'zz', version: '2.0', register: () => undefined }]);
    const text = other.save(other.newGame({ seed: 1 }).state, replay(1));
    expect(() => engine.load(text)).toThrow('[nh@1.0.0, fk@1.0.0, zz@2.0] but the game has [nh@1.0.0, fk@1.0.0] loaded');
    const none = createEngine([terrainMod()]);
    expect(() => engine.load(none.save(none.newGame({ seed: 1 }).state, replay(1)))).toThrow(/\[nh@1.0.0\]/);
  });
});
