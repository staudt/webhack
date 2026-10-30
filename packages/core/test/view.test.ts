import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import type { PlayerAction } from '../src/types/action';
import { DIR_LIST } from '../src/util';
import { applyUpdate, buildSnapshot, diffSnapshot } from '../src/view';
import { fakeMod } from './helpers/fakeMod';

const engine = createEngine([fakeMod]);

describe('view', () => {
  test('snapshot shape for a new game', () => {
    const { state } = engine.newGame({ seed: 7 });
    const s = buildSnapshot(engine.registry, state);
    expect(s.kind).toBe('full');
    expect(s.cells).toHaveLength(s.width * s.height);
    const ids = [...engine.registry.terrains.map((t) => t.id), 'nh:tester'].sort();
    expect(Object.keys(s.legend)).toEqual(ids);
    expect(s.legend['nh:tester']).toEqual({ ch: '@', fg: '#fff' });
    expect(s.entities).toEqual([
      { id: state.playerId, g: 'nh:tester', x: s.player.x, y: s.player.y },
    ]);
    expect(s.status).toEqual({ dlvl: 1, turn: state.turn });
    expect(s.turn).toBe(state.turn);
    const vis = s.cells.filter((c) => c.v);
    expect(vis.length).toBeGreaterThan(0);
    expect(vis.every((c) => c.g !== null)).toBe(true);
    expect(vis).toHaveLength(state.visible.length);
  });

  test('hides entities in unseen cells', () => {
    const { state } = engine.newGame({ seed: 7 });
    const other = state.nextEntityId++;
    // find a non-visible cell
    const level = state.levels[state.currentLevel]!;
    let i = 0;
    while (state.visible.includes(i)) i++;
    state.entities[String(other)] = {
      id: other,
      def: 'nh:tester',
      c: { pos: { level: level.id, x: i % level.width, y: Math.floor(i / level.width) } },
    };
    const s = buildSnapshot(engine.registry, state);
    expect(s.entities.map((e) => e.id)).toEqual([state.playerId]);
    state.entities[String(other)]!.c.pos = { level: 'elsewhere', x: 0, y: 0 };
    expect(buildSnapshot(engine.registry, state).entities).toHaveLength(1);
  });

  test('diff after wait has no cell changes', () => {
    const { state } = engine.newGame({ seed: 3 });
    const prev = buildSnapshot(engine.registry, state);
    engine.step(state, { type: 'wait' });
    const d = diffSnapshot(prev, buildSnapshot(engine.registry, state));
    expect(d.kind).toBe('delta');
    if (d.kind === 'delta') {
      expect(d.cells).toEqual([]);
      expect(d.turn).toBe(state.turn);
    }
  });

  test('level size change yields full', () => {
    const a = buildSnapshot(
      engine.registry,
      engine.newGame({ seed: 1, width: 80, height: 21 }).state,
    );
    const b = buildSnapshot(
      engine.registry,
      engine.newGame({ seed: 1, width: 60, height: 30 }).state,
    );
    expect(diffSnapshot(a, b)).toBe(b);
    const c = { ...a, levelId: 'dlvl2' };
    expect(diffSnapshot(a, c)).toBe(c);
  });

  test('applyUpdate: full replaces, delta without prev throws, prev not mutated', () => {
    const { state } = engine.newGame({ seed: 5 });
    const a = buildSnapshot(engine.registry, state);
    expect(applyUpdate(null, a)).toBe(a);
    expect(() =>
      applyUpdate(null, {
        kind: 'delta',
        turn: 1,
        cells: [],
        entities: [],
        player: a.player,
        status: {},
        inventory: [],
      }),
    ).toThrow();
    const before = structuredClone(a);
    applyUpdate(a, {
      kind: 'delta',
      turn: 9,
      cells: [[0, { g: 'nh:floor', v: true }]],
      entities: [],
      player: a.player,
      status: {},
      inventory: [],
    });
    expect(a).toEqual(before);
  });

  test('delta applied to prev equals fresh snapshot over random walks', () => {
    const action = fc.oneof(
      fc.constantFrom(...DIR_LIST).map((dir): PlayerAction => ({ type: 'move', dir })),
      fc.constant<PlayerAction>({ type: 'wait' }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.array(action, { maxLength: 40 }),
        (seed, actions) => {
          const { state } = engine.newGame({ seed });
          let mirror = buildSnapshot(engine.registry, state);
          for (const a of actions) {
            engine.step(state, a);
            const next = buildSnapshot(engine.registry, state);
            const d = diffSnapshot(mirror, next);
            mirror = applyUpdate(mirror, structuredClone(d));
            expect(mirror).toEqual(next);
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 30_000);

  test('moving reveals only changed cells in delta', () => {
    let sawChange = false;
    for (let seed = 1; seed <= 6 && !sawChange; seed++) {
      const { state } = engine.newGame({ seed });
      let prev = buildSnapshot(engine.registry, state);
      for (let k = 0; k < 160; k++) {
        engine.step(state, { type: 'move', dir: DIR_LIST[Math.floor(k / 8) % 8]! });
        const next = buildSnapshot(engine.registry, state);
        const d = diffSnapshot(prev, next);
        if (d.kind === 'delta' && d.cells.length > 0) {
          sawChange = true;
          expect(d.cells.length).toBeLessThan(next.cells.length);
          for (const [i, c] of d.cells) expect(next.cells[i]).toEqual(c);
        }
        prev = next;
      }
    }
    expect(sawChange).toBe(true);
  });

  test('250x250 snapshot builds', () => {
    const { state } = engine.newGame({ seed: 2, width: 250, height: 250 });
    const s = buildSnapshot(engine.registry, state);
    expect(s.cells).toHaveLength(62500);
  });
});
