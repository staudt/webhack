import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { getLevel, playerPos } from '../src/state';
import type { ModApi } from '../src/types/mod';
import { actionsMod, terrainMod } from './helpers/fakeMods';

const mk = (extra?: (api: ModApi) => void) => createEngine([terrainMod(), actionsMod(extra)]);
const game = (e = mk()) => {
  const { state } = e.newGame({ seed: 5, width: 40, height: 15 });
  return { e, state, q: e.query(state) };
};

describe('describe', () => {
  test('out of bounds', () => {
    const { q } = game();
    const none = { terrain: null, remembered: false, visible: false, entities: [] };
    expect(q.describe({ x: -1, y: 0 })).toEqual(none);
    expect(q.describe({ x: 0, y: 99 })).toEqual(none);
  });

  test('unknown cell', () => {
    const { state, q } = game();
    const level = getLevel(state);
    const i = (state.memory['dlvl1'] ?? []).findIndex((m) => m === -1);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(q.describe({ x: i % level.width, y: Math.floor(i / level.width) })).toEqual({
      terrain: null,
      remembered: false,
      visible: false,
      entities: [],
    });
  });

  test('remembered but not visible: terrain, no entities', () => {
    const { state, q } = game();
    const level = getLevel(state);
    const mem = state.memory['dlvl1'] ?? [];
    const i = mem.findIndex((m, idx) => m >= 0 && !state.visible.includes(idx));
    // nothing remembered outside vision at start: fake it
    const j = i === -1 ? mem.findIndex((m) => m === -1) : i;
    mem[j] = 1;
    state.visible = state.visible.filter((v) => v !== j);
    const d = q.describe({ x: j % level.width, y: Math.floor(j / level.width) });
    expect(d).toEqual({ terrain: level.palette[1], remembered: true, visible: false, entities: [] });
  });

  test('visible cell with the player entity', () => {
    const { state, q } = game();
    const p = playerPos(state);
    const d = q.describe(p);
    expect(d.visible).toBe(true);
    expect(d.remembered).toBe(true);
    expect(d.terrain).toBe('nh:stairs_up');
    expect(d.entities).toEqual([{ id: state.playerId, def: 'nh:hero' }]);
  });

  test('entities without a position or on other levels are skipped', () => {
    const { state, q } = game();
    state.entities['50'] = { id: 50, def: 'nh:hero', c: {} };
    const p = playerPos(state);
    state.entities['51'] = { id: 51, def: 'nh:hero', c: { pos: { level: 'other', x: p.x, y: p.y } } };
    expect(q.describe(p).entities).toHaveLength(1);
  });
});

describe('actionsFor', () => {
  test('player entity maps to self; offers get source', () => {
    const { state, q } = game();
    const self = q.actionsFor({ kind: 'self' });
    expect(self).toEqual([{ action: { type: 'wait' }, labelKey: 'a.wait', source: 'fk' }]);
    expect(q.actionsFor({ kind: 'entity', id: state.playerId })).toEqual(self);
    expect(q.actionsFor({ kind: 'entity', id: 999 })).toEqual([]);
    expect(q.actionsFor({ kind: 'cell', pos: { x: 1, y: 1 } })).toMatchObject([{ source: 'fk' }]);
  });

  test.each([
    ['rng', (c: { rng: { rn2(n: number): number } }) => c.rng.rn2(2)],
    ['cosmetic', (c: { cosmetic: { rn2(n: number): number } }) => c.cosmetic.rn2(2)],
  ])('offer() using ctx.%s throws', (_n, use) => {
    const { q } = game(
      mk((api) =>
        api.defineAction({
          id: 'fk:bad',
          labelKey: 'x',
          handles: 'mod',
          offer: (ctx) => {
            use(ctx);
            return [];
          },
          perform: () => 0,
        }),
      ),
    );
    expect(() => q.actionsFor({ kind: 'self' })).toThrow('Queries must not use the RNG');
  });

  test('offer() emitting or scheduling throws', () => {
    const { q } = game(
      mk((api) =>
        api.defineAction({
          id: 'fk:bad',
          labelKey: 'x',
          handles: 'mod',
          offer: (ctx, t) => {
            if (t.kind === 'self') ctx.emit({ type: 'searched' });
            else ctx.schedule(1, 'fk:t', null);
            return [];
          },
          perform: () => 0,
        }),
      ),
    );
    expect(() => q.actionsFor({ kind: 'self' })).toThrow('must not emit');
    expect(() => q.actionsFor({ kind: 'cell', pos: { x: 0, y: 0 } })).toThrow('must not schedule');
  });
});

describe('pathTo', () => {
  test('finds a path over remembered cells; null for unknown', () => {
    const { state, q } = game();
    const level = getLevel(state);
    const mem = state.memory['dlvl1'] ?? [];
    const p = playerPos(state);
    const target = state.visible
      .map((i) => ({ x: i % level.width, y: Math.floor(i / level.width) }))
      .find((c) => (c.x !== p.x || c.y !== p.y) && (mem[c.y * level.width + c.x] ?? -1) >= 0 && Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) === 1 && level.palette[mem[c.y * level.width + c.x] ?? 0] === 'nh:floor');
    expect(target).toBeDefined();
    if (target) expect(q.pathTo(target)).toEqual([target]);
    const unknown = mem.findIndex((m) => m === -1);
    expect(q.pathTo({ x: unknown % level.width, y: Math.floor(unknown / level.width) })).toBeNull();
  });

  test('null without memory for the level', () => {
    const { state, q } = game();
    delete state.memory['dlvl1'];
    expect(q.pathTo({ x: 1, y: 1 })).toBeNull();
  });
});
