import { describe, expect, test } from 'vitest';
import { UnknownActionError, createEngine } from '../src/engine';
import { isJsonPlain, stateHash } from '../src/hash';
import { ModLoadError } from '../src/registry';
import { getLevel, getPlayer } from '../src/state';
import type { DefId } from '../src/types/common';
import type { ModApi } from '../src/types/mod';
import { actionsMod, costAction, terrainMod } from './helpers/fakeMods';

const mk = (extra?: (api: ModApi) => void, speed = 12) =>
  createEngine([terrainMod([{ id: 'nh:hero', speed }]), actionsMod(extra)]);
const newGame = (e = mk(), seed = 7) => e.newGame({ seed, width: 40, height: 15 });

describe('createEngine', () => {
  test('fails when levelgen terrain is missing', () => {
    const partial = {
      id: 'nh',
      version: '1',
      register: (api: ModApi) =>
        api.defineTerrain({
          id: 'nh:stone',
          nameKey: 'x',
          passable: false,
          opaque: true,
          glyph: { ch: ' ', fg: '#000' },
        }),
    };
    expect(() => createEngine([partial])).toThrow(ModLoadError);
  });
});

describe('newGame', () => {
  test('player starts on the up stairs with full energy at turn 1', () => {
    const { state, events } = newGame();
    const p = getPlayer(state);
    const level = getLevel(state);
    expect(p.c.pos).toMatchObject({ level: 'dlvl1', x: level.up?.x, y: level.up?.y });
    expect(p.c.actor?.energy).toBe(12);
    expect(state.turn).toBe(1);
    expect(events[0]).toEqual({ type: 'msg', key: 'welcome', params: { role: '@role.hero' } });
  });

  test('visible is non-empty and sorted; memory is updated', () => {
    const { state } = newGame();
    expect(state.visible.length).toBeGreaterThan(0);
    expect(state.visible).toEqual([...state.visible].sort((a, b) => a - b));
    const mem = state.memory['dlvl1'] ?? [];
    for (const i of state.visible) expect(mem[i]).toBeGreaterThanOrEqual(0);
  });

  test('newLevel hooks run', () => {
    const seen: string[] = [];
    const e = mk((api) => api.on('newLevel', (_c, l) => void seen.push(l.id)));
    newGame(e);
    expect(seen).toEqual(['dlvl1']);
  });

  test('default role is the first registered; explicit role is honored', () => {
    const e = createEngine([
      terrainMod([
        { id: 'nh:a', speed: 12 },
        { id: 'nh:b', speed: 6 },
      ]),
    ]);
    const a = e.newGame({ seed: 1 }).state;
    expect(getPlayer(a).def).toBe('nh:a');
    const b = e.newGame({ seed: 1, role: 'nh:b' }).state;
    expect(getPlayer(b).def).toBe('nh:b');
    expect(getPlayer(b).c.actor?.speed).toBe(6);
  });

  test('no roles is an error', () => {
    const e = createEngine([terrainMod([])]);
    expect(() => e.newGame({ seed: 1 })).toThrow('No player role registered');
  });

  test('width and height are honored; defaults are 80x21', () => {
    const { state } = newGame();
    expect(getLevel(state)).toMatchObject({ width: 40, height: 15 });
    const d = createEngine([terrainMod()]).newGame({ seed: 3 }).state;
    expect(getLevel(d)).toMatchObject({ width: 80, height: 21 });
  });

  test('seed is normalized with >>> 0', () => {
    const e = mk();
    const a = e.newGame({ seed: -1, width: 40, height: 15 }).state;
    expect(a.seed).toBe(0xffffffff);
    const b = e.newGame({ seed: 0xffffffff, width: 40, height: 15 }).state;
    expect(stateHash(a)).toBe(stateHash(b));
  });
});

describe('step', () => {
  test('unknown action throws', () => {
    const { state } = newGame();
    expect(() => mk().step(state, { type: 'search' })).toThrow(UnknownActionError);
    expect(() => mk().step(state, { type: 'mod', action: 'fk:nope' })).toThrow(UnknownActionError);
  });

  test('beforeAction cancel stops everything', () => {
    const calls: string[] = [];
    const e = mk((api) => {
      api.on('beforeAction', () => 'cancel');
      api.on('afterAction', () => void calls.push('after'));
    });
    const { state } = newGame(e);
    const hash = stateHash(state);
    const r = e.step(state, { type: 'wait' });
    expect(r.events).toEqual([]);
    expect(state.turn).toBe(1);
    expect(stateHash(state)).toBe(hash);
    expect(calls).toEqual([]);
  });

  test('afterAction runs', () => {
    const calls: string[] = [];
    const e = mk((api) => api.on('afterAction', (_c, a) => void calls.push(a.type)));
    const { state } = newGame(e);
    e.step(state, { type: 'wait' });
    expect(calls).toEqual(['wait']);
  });

  test.each([-1, 1.5, NaN])('invalid cost %s throws', (cost) => {
    const e = mk();
    const { state } = newGame(e);
    expect(() => e.step(state, costAction(cost))).toThrow(/invalid energy cost/);
  });

  test('cost 0: no turn', () => {
    const e = mk();
    const { state } = newGame(e);
    const r = e.step(state, costAction(0));
    expect(state.turn).toBe(1);
    expect(r.events).toEqual([]);
  });

  test('cost 12: one turn and turnEnded', () => {
    const e = mk();
    const { state } = newGame(e);
    const r = e.step(state, costAction(12));
    expect(state.turn).toBe(2);
    expect(r.events).toEqual([{ type: 'turnEnded', turn: 2 }]);
  });

  test('cost 24: two turns', () => {
    const e = mk();
    const { state } = newGame(e);
    const r = e.step(state, costAction(24));
    expect(state.turn).toBe(3);
    expect(r.events.map((x) => x.type)).toEqual(['turnEnded', 'turnEnded']);
  });

  test('speed 6 acts every other turn', () => {
    const e = mk(undefined, 6);
    const { state } = newGame(e);
    const turns: number[] = [];
    for (let i = 0; i < 4; i++) {
      e.step(state, { type: 'wait' });
      turns.push(state.turn);
    }
    // 12 energy start, +6 per turn: each wait takes 2 turns
    expect(turns).toEqual([3, 5, 7, 9]);
  });

  test('non-positive player speed throws', () => {
    const e = mk();
    const { state } = newGame(e);
    const actor = getPlayer(state).c.actor;
    if (actor) actor.speed = 0;
    expect(() => e.step(state, { type: 'wait' })).toThrow('speed must be positive');
  });

  test('missing actor component throws', () => {
    const e = mk();
    const { state } = newGame(e);
    delete getPlayer(state).c.actor;
    expect(() => e.step(state, { type: 'wait' })).toThrow('no actor');
  });

  test('endOfTurn hooks run in priority/mod/registration order', () => {
    const order: string[] = [];
    const e = mk((api) => {
      api.on('endOfTurn', () => void order.push('a0'));
      api.on('endOfTurn', () => void order.push('b5'), { priority: 5 });
      api.on('endOfTurn', () => void order.push('c0'));
    });
    const { state } = newGame(e);
    e.step(state, { type: 'wait' });
    expect(order).toEqual(['b5', 'a0', 'c0']);
  });

  test('state stays JSON-plain after many steps', () => {
    const e = mk();
    const { state } = newGame(e);
    for (let i = 0; i < 100; i++) e.step(state, i % 3 === 0 ? costAction(30) : { type: 'wait' });
    expect(isJsonPlain(state)).toBe(true);
  });

  test('deterministic: same seed and actions give the same hash', () => {
    const run = () => {
      const e = mk();
      const { state } = newGame(e, 99);
      for (let i = 0; i < 20; i++) e.step(state, i % 2 ? { type: 'wait' } : costAction(18));
      return stateHash(state);
    };
    expect(run()).toBe(run());
  });
});

describe('timers', () => {
  const T1 = 'fk:t1' as DefId;
  const T2 = 'fk:t2' as DefId;

  const withTimers = (log: string[]) =>
    mk((api) => {
      api.defineTimer({
        id: T1,
        fire(ctx, data) {
          log.push(`t1@${ctx.state.turn}:${String(data)}`);
        },
      });
      api.defineTimer({
        id: T2,
        fire(ctx, data) {
          log.push(`t2@${ctx.state.turn}:${String(data)}`);
          ctx.schedule(2, T1, 'chained');
        },
      });
      api.defineAction({
        id: 'fk:sched',
        labelKey: 'a.sched',
        handles: 'mod',
        offer: () => [],
        perform(ctx, a) {
          const args = (a.type === 'mod' ? a.args : null) as {
            delay: number;
            kind: DefId;
            data: string;
          };
          ctx.schedule(args.delay, args.kind, args.data);
          return 0;
        },
      });
    });
  const sched = (delay: number, kind: string, data = 'd') =>
    ({ type: 'mod', action: 'fk:sched', args: { delay, kind, data } }) as const;

  test('schedule validates delay and kind', () => {
    const e = withTimers([]);
    const { state } = newGame(e);
    for (const d of [0, -1, 1.5]) expect(() => e.step(state, sched(d, T1))).toThrow(RangeError);
    expect(() => e.step(state, sched(1, 'fk:missing'))).toThrow("Unknown timer 'fk:missing'");
    expect(state.timers).toEqual([]);
  });

  test('fire in (at, seq) order on the right turn', () => {
    const log: string[] = [];
    const e = withTimers(log);
    const { state } = newGame(e);
    e.step(state, sched(3, T1, 'late'));
    e.step(state, sched(1, T1, 'a'));
    e.step(state, sched(1, T1, 'b'));
    e.step(state, sched(2, T1, 'mid'));
    expect(state.timers.map((t) => [t.at, t.seq])).toEqual([
      [2, 1],
      [2, 2],
      [3, 3],
      [4, 0],
    ]);
    e.step(state, costAction(12 * 5));
    expect(log).toEqual(['t1@2:a', 't1@2:b', 't1@3:mid', 't1@4:late']);
    expect(state.timers).toEqual([]);
  });

  test('a timer scheduling another timer', () => {
    const log: string[] = [];
    const e = withTimers(log);
    const { state } = newGame(e);
    e.step(state, sched(1, T2, 'x'));
    e.step(state, costAction(12 * 5));
    expect(log).toEqual(['t2@2:x', 't1@4:chained']);
  });
});
