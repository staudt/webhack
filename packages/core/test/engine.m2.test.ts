import { beforeEach, describe, expect, test } from 'vitest';
import { MAX_REPEAT, createEngine } from '../src/engine';
import { getLevel, getPlayer } from '../src/state';
import type { PlayerAction } from '../src/types/action';
import type { DefId, EntityId, Json } from '../src/types/common';
import type { GameOver, GameState } from '../src/types/state';
import type { Ctx, Mod, MonsterDef } from '../src/types/mod';
import { SAVE_VERSION } from '../src/save';
import { buildSnapshot } from '../src/view';
import { actionsMod, terrainMod } from './helpers/fakeMods';

type ActFn = (ctx: Ctx, id: EntityId) => void;
const noop = (): void => undefined;

/** Mutable knobs the fake mods read, reset before each test. */
const ctl = {
  calls: [] as { brain: string; id: EntityId; turn: number }[],
  onAct: noop as ActFn,
  movement: 12,
  walks: 0,
  walkMax: 5,
  walkCost: 12,
  walkEndAt: 0,
  interruptAt: 0,
  cancelWalk: false,
  askAt: 0,
  offer: null as null | ((ctx: Ctx) => void),
  answered: [] as { value: Json; data: Json }[],
  newGame: [] as { hero: EntityId; hadPos: boolean; levels: number }[],
  newLevels: [] as string[],
  spawned: [] as EntityId[],
};

beforeEach(() => {
  ctl.calls = [];
  ctl.onAct = noop;
  ctl.movement = 12;
  ctl.walks = 0;
  ctl.walkMax = 5;
  ctl.walkCost = 12;
  ctl.walkEndAt = 0;
  ctl.interruptAt = 0;
  ctl.cancelWalk = false;
  ctl.askAt = 0;
  ctl.offer = null;
  ctl.answered = [];
  ctl.newGame = [];
  ctl.newLevels = [];
  ctl.spawned = [];
});

const monDef = (name: string, brain: `${string}:${string}`): MonsterDef => ({
  id: `mm:${name}` as const,
  nameKey: `mon.${name}`,
  glyph: { ch: 'x', fg: '#f00' },
  level: 1,
  speed: 12,
  ac: 7,
  mr: 0,
  alignment: 0,
  attacks: [],
  size: 'small',
  flags: [],
  frequency: 1,
  group: null,
  genFlags: [],
  difficulty: 1,
  weight: 100,
  nutrition: 100,
  brain,
});

const mmMod: Mod = {
  id: 'mm',
  version: '1.0.0',
  register(api) {
    api.defineBrain({
      id: 'mm:rec',
      act(ctx, id) {
        ctl.calls.push({ brain: 'rec', id, turn: ctx.state.turn });
        ctl.onAct(ctx, id);
      },
    });
    api.defineBrain({
      id: 'mm:mv',
      act(ctx, id) {
        ctl.calls.push({ brain: 'mv', id, turn: ctx.state.turn });
      },
      movement: () => ctl.movement,
    });
    api.defineMonster(monDef('mon', 'mm:rec'));
    api.defineMonster(monDef('mover', 'mm:mv'));
    api.on('newGame', (_ctx, hero) => {
      ctl.newGame.push({
        hero,
        hadPos: _ctx.state.entities[String(hero)]?.c.pos !== undefined,
        levels: Object.keys(_ctx.state.levels).length,
      });
    });
    api.on('newLevel', (_ctx, level) => void ctl.newLevels.push(level.id));
    api.on('beforeAction', (_ctx, a) =>
      ctl.cancelWalk && a.type === 'mod' && a.action === 'fk:walk' ? 'cancel' : 'continue',
    );
    api.on('afterAction', (ctx, a) => {
      if (a.type === 'mod' && a.action === 'fk:walk' && ctl.walks === ctl.interruptAt)
        ctx.interrupt();
    });
  },
};

const fkExtra = (api: Parameters<Mod['register']>[0]): void => {
  api.defineAction({
    id: 'fk:walk',
    labelKey: 'a.walk',
    handles: 'mod',
    offer: () => [],
    perform(ctx) {
      ctl.walks++;
      if (ctl.walks === ctl.walkEndAt) ctx.endGame(over('walked'));
      if (ctl.walks === ctl.askAt) ctx.ask({ id: 'p1', kind: 'yn', key: 'q.yn' }, 'fk:walk', null);
      return ctl.walkCost;
    },
    continues: () => ctl.walks < ctl.walkMax,
    answer: () => 12,
  });
  api.defineAction({
    id: 'fk:goto',
    labelKey: 'a.goto',
    handles: 'mod',
    offer: () => [],
    perform(ctx, a) {
      const args = (a.type === 'mod' ? a.args : null) as { depth: number; at: 'up' | 'down' };
      ctx.goToLevel(args.depth, args.at);
      return 12;
    },
  });
  api.defineAction({
    id: 'fk:spawn',
    labelKey: 'a.spawn',
    handles: 'mod',
    offer: () => [],
    perform(ctx) {
      const pos = getPlayer(ctx.state).c.pos;
      ctl.spawned.push(ctx.spawn({ def: 'nh:hero', c: pos ? { pos: { ...pos } } : {} }));
      return 0;
    },
  });
  api.defineAction({
    id: 'fk:remove',
    labelKey: 'a.remove',
    handles: 'mod',
    offer: () => [],
    perform(ctx) {
      ctx.remove(ctx.state.playerId);
      return 0;
    },
  });
  api.defineAction({
    id: 'fk:end',
    labelKey: 'a.end',
    handles: 'mod',
    offer: () => [],
    perform(ctx, a) {
      const k = (a.type === 'mod' ? (a.args as string) : '') || 'x';
      ctx.endGame(over(k));
      ctx.endGame(over('second'));
      return 0;
    },
  });
  api.defineAction({
    id: 'fk:ask',
    labelKey: 'a.ask',
    handles: 'mod',
    offer: () => [],
    perform(ctx) {
      ctx.ask({ id: 'p1', kind: 'yn', key: 'q.yn' }, 'fk:ask', { n: 7 });
      return 0;
    },
    answer(_ctx, value, data) {
      ctl.answered.push({ value, data });
      return 12;
    },
  });
  api.defineAction({
    id: 'fk:noans',
    labelKey: 'a.noans',
    handles: 'mod',
    offer: () => [],
    perform(ctx) {
      ctx.ask({ id: 'p2', kind: 'yn', key: 'q' }, 'fk:noans', null);
      return 0;
    },
  });
  api.defineAction({
    id: 'fk:badask',
    labelKey: 'a.badask',
    handles: 'mod',
    offer: () => [],
    perform(ctx) {
      ctx.ask({ id: 'p3', kind: 'yn', key: 'q' }, 'fk:missing', null);
      return 0;
    },
  });
  api.defineAction({
    id: 'fk:offerer',
    labelKey: 'a.offerer',
    handles: 'mod',
    offer(ctx) {
      ctl.offer?.(ctx);
      return [];
    },
    perform: () => 0,
  });
};

const over = (killer: string): GameOver => ({ kind: 'died', killer, turn: 1, depth: 1, level: 1 });

const engine = createEngine([terrainMod(), actionsMod(fkExtra), mmMod]);
const fresh = (): GameState => engine.newGame({ seed: 5, width: 40, height: 15 }).state;
const mod = (action: DefId, args?: Json): PlayerAction =>
  args === undefined ? { type: 'mod', action } : { type: 'mod', action, args };
const WAIT: PlayerAction = { type: 'wait' };

/** A floor cell on level 1 other than the hero's, offset by n. */
function floor(state: GameState, n: number): { level: string; x: number; y: number } {
  const level = getLevel(state, 'dlvl1');
  const hero = getPlayer(state).c.pos;
  const cells: { x: number; y: number }[] = [];
  for (const r of level.rooms)
    for (let y = r.ly; y <= r.hy; y++)
      for (let x = r.lx; x <= r.hx; x++)
        if (!(hero && hero.x === x && hero.y === y)) cells.push({ x, y });
  const c = cells[n % cells.length];
  if (!c) throw new Error('no floor');
  return { level: 'dlvl1', ...c };
}

function addMon(
  state: GameState,
  def: DefId,
  opts: { speed?: number; energy?: number; actor?: boolean; level?: string; at?: number } = {},
): EntityId {
  const id = state.nextEntityId++;
  const p = floor(state, opts.at ?? id);
  state.entities[String(id)] = {
    id,
    def,
    c: {
      pos: { ...p, level: opts.level ?? p.level },
      ...(opts.actor === false
        ? {}
        : { actor: { energy: opts.energy ?? 0, speed: opts.speed ?? 12 } }),
    },
  };
  return id;
}

const ids = (): EntityId[] => ctl.calls.map((c) => c.id);

describe('turn loop with monsters', () => {
  test('no monsters: turn advances by one per 12-cost action', () => {
    const s = fresh();
    const t0 = s.turn;
    for (let i = 1; i <= 5; i++) {
      engine.step(s, WAIT);
      expect(s.turn).toBe(t0 + i);
    }
    expect(getPlayer(s).c.actor?.energy).toBe(12);
  });

  test('speed-12 monsters act once per turn in sorted id order', () => {
    const s = fresh();
    const a = addMon(s, 'mm:mon');
    const b = addMon(s, 'mm:mon');
    const c = addMon(s, 'mm:mon');
    engine.step(s, WAIT); // energy 12 after the turn ends
    expect(ctl.calls).toEqual([]);
    engine.step(s, WAIT);
    expect(ids()).toEqual([a, b, c]);
    engine.step(s, WAIT);
    expect(ids()).toEqual([a, b, c, a, b, c]);
  });

  test('speed 24 acts twice per turn, speed 6 every other turn', () => {
    const s = fresh();
    const fast = addMon(s, 'mm:mon', { speed: 24 });
    const slow = addMon(s, 'mm:mon', { speed: 6 });
    const count = (id: EntityId): number => ids().filter((i) => i === id).length;
    for (let i = 0; i < 5; i++) engine.step(s, WAIT);
    // Turns 2..5 run movemon after turn ends 1..4: fast has 24 per turn, slow gains 6.
    expect(count(fast)).toBe(8);
    expect(count(slow)).toBe(2);
    const order = ctl.calls.slice(0, 2).map((c) => c.id);
    expect(order).toEqual([fast, fast]);
  });

  test('brain.movement overrides actor speed', () => {
    const s = fresh();
    const m = addMon(s, 'mm:mover', { speed: 12 });
    ctl.movement = 24;
    for (let i = 0; i < 4; i++) engine.step(s, WAIT);
    expect(ids().filter((i) => i === m)).toHaveLength(6);
    ctl.calls = [];
    ctl.movement = 0;
    getPlayer(s).c.actor!.energy = 12;
    s.entities[String(m)]!.c.actor!.energy = 0;
    for (let i = 0; i < 4; i++) engine.step(s, WAIT);
    expect(ctl.calls).toEqual([]);
  });

  test('monsters on other levels and actors without a monster def do not act', () => {
    const s = fresh();
    addMon(s, 'mm:mon', { level: 'dlvl2', energy: 100 });
    addMon(s, 'nh:hero', { energy: 100 });
    for (let i = 0; i < 3; i++) engine.step(s, WAIT);
    expect(ctl.calls).toEqual([]);
    // Neither gained energy at end of turn either.
    expect(
      Object.values(s.entities).filter((e) => e.def === 'nh:hero' && e.id !== s.playerId)[0]?.c
        .actor?.energy,
    ).toBe(100);
    expect(Object.values(s.entities).find((e) => e.def === 'mm:mon')?.c.actor?.energy).toBe(100);
  });

  test('a monster without actor does not act', () => {
    const s = fresh();
    addMon(s, 'mm:mon', { actor: false });
    for (let i = 0; i < 3; i++) engine.step(s, WAIT);
    expect(ctl.calls).toEqual([]);
  });

  test('a monster removed by an earlier monster is skipped', () => {
    const s = fresh();
    const a = addMon(s, 'mm:mon', { energy: 12 });
    const b = addMon(s, 'mm:mon', { energy: 12 });
    ctl.onAct = (ctx, id) => {
      if (id === a) ctx.remove(b);
    };
    engine.step(s, WAIT);
    expect(ids()).toEqual([a]);
    expect(s.entities[String(b)]).toBeUndefined();
  });

  test('a monster moved off the level by an earlier monster is skipped', () => {
    const s = fresh();
    const a = addMon(s, 'mm:mon', { energy: 12 });
    const b = addMon(s, 'mm:mon', { energy: 12 });
    ctl.onAct = (ctx, id) => {
      const pos = ctx.state.entities[String(b)]?.c.pos;
      if (id === a && pos) pos.level = 'dlvl2';
    };
    engine.step(s, WAIT);
    expect(ids()).toEqual([a]);
  });

  test('endGame in a brain stops the loop immediately', () => {
    const s = fresh();
    const a = addMon(s, 'mm:mon', { energy: 12 });
    addMon(s, 'mm:mon', { energy: 12 });
    const turn = s.turn;
    ctl.onAct = (ctx, id) => {
      if (id === a) ctx.endGame(over('brain'));
    };
    engine.step(s, WAIT);
    expect(ids()).toEqual([a]);
    expect(s.turn).toBe(turn);
    expect(s.gameOver?.killer).toBe('brain');
  });
});

describe('ctx primitives', () => {
  test('spawn assigns increasing ids', () => {
    const s = fresh();
    const next = s.nextEntityId;
    engine.step(s, mod('fk:spawn'));
    engine.step(s, mod('fk:spawn'));
    expect(ctl.spawned).toEqual([next, next + 1]);
    expect(s.entities[String(next)]?.id).toBe(next);
    expect(s.nextEntityId).toBe(next + 2);
  });

  test('remove(hero) throws', () => {
    expect(() => engine.step(fresh(), mod('fk:remove'))).toThrow('The hero cannot be removed');
  });

  test('goToLevel generates lazily, fires newLevel once, keeps memory per level', () => {
    const s = fresh();
    const w = getLevel(s).width;
    const h = getLevel(s).height;
    expect(ctl.newLevels).toEqual(['dlvl1']);
    const mem1 = [...(s.memory['dlvl1'] ?? [])];
    engine.step(s, mod('fk:goto', { depth: 2, at: 'up' }));
    const l2 = getLevel(s, 'dlvl2');
    expect([l2.width, l2.height, l2.depth]).toEqual([w, h, 2]);
    expect(s.currentLevel).toBe('dlvl2');
    expect(ctl.newLevels).toEqual(['dlvl1', 'dlvl2']);
    expect(getPlayer(s).c.pos).toEqual({ level: 'dlvl2', x: l2.up!.x, y: l2.up!.y });
    expect(s.memory['dlvl2']?.some((m) => m >= 0)).toBe(true);
    expect(s.memory['dlvl1']).toEqual(mem1);

    engine.step(s, mod('fk:goto', { depth: 1, at: 'down' }));
    const l1 = getLevel(s, 'dlvl1');
    expect(s.currentLevel).toBe('dlvl1');
    expect(getPlayer(s).c.pos).toEqual({ level: 'dlvl1', x: l1.down!.x, y: l1.down!.y });
    expect(ctl.newLevels).toEqual(['dlvl1', 'dlvl2']);

    engine.step(s, mod('fk:goto', { depth: 2, at: 'down' }));
    expect(ctl.newLevels).toEqual(['dlvl1', 'dlvl2']);
    expect(getPlayer(s).c.pos).toMatchObject({ level: 'dlvl2', x: l2.down!.x, y: l2.down!.y });
  });

  test('a monster on the arrival stairs is moved to the nearest free cell', () => {
    const s = fresh();
    engine.step(s, mod('fk:goto', { depth: 2, at: 'up' }));
    const down = getLevel(s, 'dlvl1').down!;
    const m = addMon(s, 'mm:mon', { energy: 0 });
    s.entities[String(m)]!.c.pos = { level: 'dlvl1', x: down.x, y: down.y };
    engine.step(s, mod('fk:goto', { depth: 1, at: 'down' }));
    const p = s.entities[String(m)]!.c.pos!;
    expect(p.level).toBe('dlvl1');
    expect(Math.max(Math.abs(p.x - down.x), Math.abs(p.y - down.y))).toBe(1);
    const lvl = getLevel(s, 'dlvl1');
    const terrain = lvl.palette[lvl.cells[p.y * lvl.width + p.x] ?? 0]!;
    expect(engine.registry.terrain(terrain).passable).toBe(true);
  });

  test('a monster with no free cell around stays put', () => {
    const s = fresh();
    engine.step(s, mod('fk:goto', { depth: 2, at: 'up' }));
    const lvl = getLevel(s, 'dlvl1');
    const down = lvl.down!;
    const m = addMon(s, 'mm:mon');
    s.entities[String(m)]!.c.pos = { level: 'dlvl1', x: down.x, y: down.y };
    // Make everything solid except the stairs.
    const solid = lvl.palette.findIndex((t) => !engine.registry.terrain(t).passable);
    const stairIdx = down.y * lvl.width + down.x;
    lvl.cells = lvl.cells.map((c, i) => (i === stairIdx ? c : solid));
    engine.step(s, mod('fk:goto', { depth: 1, at: 'down' }));
    expect(s.entities[String(m)]!.c.pos).toMatchObject({ x: down.x, y: down.y });
  });

  test('bad depth throws', () => {
    for (const depth of [0, -1, 1.5])
      expect(() => engine.step(fresh(), mod('fk:goto', { depth, at: 'up' }))).toThrow(RangeError);
  });
});

describe('prompts', () => {
  test('ask returns the prompt and blocks other actions', () => {
    const s = fresh();
    const r = engine.step(s, mod('fk:ask'));
    expect(r.prompt).toEqual({ id: 'p1', kind: 'yn', key: 'q.yn' });
    expect(s.pendingPrompt).toEqual({ prompt: r.prompt, handler: 'fk:ask', data: { n: 7 } });
    expect(() => engine.step(s, WAIT)).toThrow("Prompt 'p1' must be answered first");
    expect(() => engine.step(s, { type: 'answer', promptId: 'zz', value: 1 })).toThrow(
      "Prompt 'p1' must be answered first",
    );
    expect(s.pendingPrompt).not.toBeNull();
  });

  test('answer routes to the handler, clears the prompt and spends its cost', () => {
    const s = fresh();
    engine.step(s, mod('fk:ask'));
    const turn = s.turn;
    const r = engine.step(s, { type: 'answer', promptId: 'p1', value: 'y' });
    expect(ctl.answered).toEqual([{ value: 'y', data: { n: 7 } }]);
    expect(s.pendingPrompt).toBeNull();
    expect(r.prompt).toBeNull();
    expect(s.turn).toBe(turn + 1);
  });

  test('answer with no pending prompt throws', () => {
    expect(() => engine.step(fresh(), { type: 'answer', promptId: 'p1', value: 1 })).toThrow(
      'There is no prompt to answer',
    );
  });

  test('ask with a handler lacking answer() throws', () => {
    expect(() => engine.step(fresh(), mod('fk:noans'))).toThrow(
      "Prompt handler 'fk:noans' has no answer()",
    );
    expect(() => engine.step(fresh(), mod('fk:badask'))).toThrow(
      "Prompt handler 'fk:missing' has no answer()",
    );
  });

  test('pending prompt whose handler lost its answer() throws on answer', () => {
    const s = fresh();
    s.pendingPrompt = {
      prompt: { id: 'q', kind: 'yn', key: 'k' },
      handler: 'fk:noans',
      data: null,
    };
    expect(() => engine.step(s, { type: 'answer', promptId: 'q', value: 1 })).toThrow(
      'has no answer()',
    );
  });
});

describe('multi-turn actions', () => {
  const CONT: PlayerAction = { type: 'continue' };

  test('a step performs one move and keeps the occupation', () => {
    const s = fresh();
    const r = engine.step(s, mod('fk:walk'));
    expect(ctl.walks).toBe(1);
    expect(r.continuing).toBe(true);
    expect(s.occupation).toEqual({ action: mod('fk:walk'), data: null });
  });

  test('continue performs the next move, with the monsters acting in between', () => {
    const s = fresh();
    addMon(s, 'mm:mon', { energy: 12 });
    const t0 = s.turn;
    engine.step(s, mod('fk:walk'));
    for (let i = 0; i < 4; i++) {
      expect(s.occupation).not.toBeNull();
      engine.step(s, CONT);
    }
    expect(ctl.walks).toBe(5);
    expect(s.turn).toBe(t0 + 5);
    expect(ctl.calls.map((c) => c.turn)).toEqual([t0, t0 + 1, t0 + 2, t0 + 3, t0 + 4]);
    expect(s.occupation).toBeNull(); // the fifth move was the last
  });

  test('the occupation is a clone of the action', () => {
    const s = fresh();
    const a = mod('fk:walk', { n: 1 });
    engine.step(s, a);
    expect(s.occupation?.action).toEqual(a);
    expect(s.occupation?.action).not.toBe(a);
  });

  test('another action cancels the occupation and is performed', () => {
    const s = fresh();
    engine.step(s, mod('fk:walk'));
    const t = s.turn;
    const r = engine.step(s, WAIT);
    expect(s.occupation).toBeNull();
    expect(r.continuing).toBe(false);
    expect(ctl.walks).toBe(1);
    expect(s.turn).toBe(t + 1);
    engine.step(s, CONT);
    expect(ctl.walks).toBe(1);
  });

  test('a different multi-turn action replaces the occupation', () => {
    const s = fresh();
    engine.step(s, mod('fk:walk', { a: 1 }));
    engine.step(s, mod('fk:walk', { a: 2 }));
    expect(s.occupation?.action).toEqual(mod('fk:walk', { a: 2 }));
    expect(ctl.walks).toBe(2);
  });

  test('continue without an occupation is a no-op', () => {
    const s = fresh();
    const t = s.turn;
    const r = engine.step(s, CONT);
    expect(r.events).toEqual([]);
    expect(r.continuing).toBe(false);
    expect(s.turn).toBe(t);
    expect(ctl.walks).toBe(0);
  });

  test('the occupation ends when continues returns false', () => {
    ctl.walkMax = 3;
    const s = fresh();
    engine.step(s, mod('fk:walk'));
    engine.step(s, CONT);
    expect(s.occupation).not.toBeNull();
    const r = engine.step(s, CONT);
    expect(ctl.walks).toBe(3);
    expect(r.continuing).toBe(false);
    expect(s.occupation).toBeNull();
  });

  test('the occupation ends on ctx.interrupt() from an afterAction hook', () => {
    ctl.interruptAt = 2;
    const s = fresh();
    engine.step(s, mod('fk:walk'));
    expect(s.occupation).not.toBeNull();
    engine.step(s, CONT);
    expect(ctl.walks).toBe(2);
    expect(s.occupation).toBeNull();
  });

  test('the occupation ends when the move cost nothing', () => {
    ctl.walkCost = 0;
    const s = fresh();
    expect(engine.step(s, mod('fk:walk')).continuing).toBe(false);
    expect(ctl.walks).toBe(1);
    expect(s.occupation).toBeNull();
  });

  test('the occupation ends on game over', () => {
    ctl.walkEndAt = 2;
    const s = fresh();
    engine.step(s, mod('fk:walk'));
    expect(s.occupation).not.toBeNull();
    engine.step(s, CONT);
    expect(s.gameOver?.killer).toBe('walked');
    expect(s.occupation).toBeNull();
  });

  test('a beforeAction cancel clears the occupation', () => {
    ctl.cancelWalk = true;
    const s = fresh();
    const r = engine.step(s, mod('fk:walk'));
    expect(ctl.walks).toBe(0);
    expect(r.continuing).toBe(false);
    expect(s.occupation).toBeNull();
  });

  test('a prompt clears the occupation', () => {
    ctl.askAt = 2;
    const s = fresh();
    engine.step(s, mod('fk:walk'));
    expect(s.occupation).not.toBeNull();
    const r = engine.step(s, CONT);
    expect(r.prompt).not.toBeNull();
    expect(s.occupation).toBeNull();
    // answering a prompt works and leaves no occupation
    engine.step(s, { type: 'answer', promptId: 'p1', value: true });
    expect(s.occupation).toBeNull();
  });

  test('stepAll performs every move and concatenates the events', () => {
    const s = fresh();
    const t0 = s.turn;
    const r = engine.stepAll(s, mod('fk:walk'));
    expect(ctl.walks).toBe(5);
    expect(s.turn).toBe(t0 + 5);
    expect(r.continuing).toBe(false);
    expect(r.events.filter((e) => e.type === 'searched')).toHaveLength(0);
  });

  test('stepAll stops at MAX_REPEAT', () => {
    ctl.walkMax = Infinity;
    const s = fresh();
    const r = engine.stepAll(s, mod('fk:walk'));
    expect(ctl.walks).toBe(MAX_REPEAT + 1); // the first step plus MAX_REPEAT continues
    expect(r.continuing).toBe(true);
  });

  test('stepAll of a plain action is a single step', () => {
    const s = fresh();
    const t0 = s.turn;
    engine.stepAll(s, WAIT);
    expect(s.turn).toBe(t0 + 1);
  });

  test('the occupation saves and loads', () => {
    const s = fresh();
    engine.step(s, mod('fk:walk'));
    const replay = { seed: 5, width: 40, height: 15, mods: [], actions: [] };
    const loaded = engine.load(engine.save(s, replay)).state;
    expect(loaded.occupation).toEqual(s.occupation);
    expect(engine.step(loaded, CONT).continuing).toBe(true);
  });
});

describe('game over', () => {
  test('endGame sets gameOver once; later steps throw', () => {
    const s = fresh();
    engine.step(s, mod('fk:end', 'first'));
    expect(s.gameOver?.killer).toBe('first');
    expect(() => engine.step(s, WAIT)).toThrow('The game is over');
  });

  test('step after game over throws', () => {
    const s = fresh();
    s.gameOver = over('k');
    expect(() => engine.step(s, WAIT)).toThrow('The game is over');
  });

  test('actionsFor is empty when game over or a prompt is pending', () => {
    const s = fresh();
    expect(engine.query(s).actionsFor({ kind: 'self' }).length).toBeGreaterThan(0);
    engine.step(s, mod('fk:ask'));
    expect(engine.query(s).actionsFor({ kind: 'self' })).toEqual([]);
    s.pendingPrompt = null;
    s.gameOver = over('k');
    expect(engine.query(s).actionsFor({ kind: 'self' })).toEqual([]);
  });

  test.each([
    ['emit', (c: Ctx) => c.emit({ type: 'searched' })],
    ['schedule', (c: Ctx) => c.schedule(1, 'x:y', null)],
    ['spawn', (c: Ctx) => c.spawn({ def: 'x:y', c: {} })],
    ['remove', (c: Ctx) => c.remove(99)],
    ['goToLevel', (c: Ctx) => c.goToLevel(2, 'up')],
    ['ask', (c: Ctx) => c.ask({ id: 'a', kind: 'yn', key: 'k' }, 'x:y', null)],
    ['interrupt', (c: Ctx) => c.interrupt()],
    ['endGame', (c: Ctx) => c.endGame(over('k'))],
  ])('offer() calling %s throws', (_name, call) => {
    const s = fresh();
    ctl.offer = call;
    expect(() => engine.query(s).actionsFor({ kind: 'self' })).toThrow(/offer\(\) must not/);
  });
});

describe('newGame', () => {
  test('newGame hooks run before level generation with the hero id', () => {
    const r = engine.newGame({ seed: 3, width: 40, height: 15 });
    const s = r.state;
    expect(ctl.newGame).toEqual([{ hero: s.playerId, hadPos: false, levels: 0 }]);
    expect(s.version).toBe(4);
    expect(s.gameOver).toBeNull();
    expect(s.pendingPrompt).toBeNull();
    expect(r.prompt).toBeNull();
    expect(getPlayer(s).c.pos).toBeDefined();
  });
});

describe('view additions', () => {
  test('legend includes monster glyphs', () => {
    const snap = buildSnapshot(engine.registry, fresh());
    expect(snap.legend['mm:mon']).toEqual({ ch: 'x', fg: '#f00' });
    expect(snap.legend['mm:mover']).toBeDefined();
  });

  test('status is just dlvl and turn without extra components', () => {
    const s = fresh();
    expect(buildSnapshot(engine.registry, s).status).toEqual({ dlvl: 1, turn: s.turn });
  });

  test('status includes hp, xl, attributes when present (AC comes from a mod status)', () => {
    const s = fresh();
    const c = getPlayer(s).c;
    c.hp = { cur: 7, max: 12 };
    c.experience = { level: 3, points: 45 };
    c.attributes = { str: 18, int: 10, wis: 9, dex: 14, con: 12, cha: 8 };
    expect(buildSnapshot(engine.registry, s).status).toEqual({
      dlvl: 1,
      turn: s.turn,
      hp: 7,
      hpmax: 12,
      xl: 3,
      xp: 45,
      str: 18,
      int: 10,
      wis: 9,
      dex: 14,
      con: 12,
      cha: 8,
    });
  });

  test('status reports death', () => {
    const s = fresh();
    s.gameOver = { kind: 'died', killer: '@mm:mon', turn: 9, depth: 2, level: 4 };
    expect(buildSnapshot(engine.registry, s).status).toMatchObject({
      dead: 'died',
      killer: '@mm:mon',
      endTurn: 9,
      endDepth: 2,
      endLevel: 4,
    });
  });
});

describe('save format', () => {
  const replay = { seed: 5, width: 40, height: 15, mods: [], actions: [] };

  test('round trip is version 4', () => {
    const s = fresh();
    const text = engine.save(s, replay);
    const raw = JSON.parse(text) as { version: number; state: { version: number } };
    expect([raw.version, raw.state.version, SAVE_VERSION]).toEqual([4, 4, 4]);
    expect(engine.load(text).state).toEqual(s);
  });

  test('a version-3 save migrates with no occupation', () => {
    const s = fresh();
    const raw = JSON.parse(engine.save(s, replay)) as {
      version: number;
      state: { version: number; occupation?: unknown };
    };
    raw.version = 3;
    raw.state.version = 3;
    delete raw.state.occupation;
    const loaded = engine.load(JSON.stringify(raw)).state;
    expect(loaded.version).toBe(4);
    expect(loaded.occupation).toBeNull();
  });

  test('a version-1 save is rejected', () => {
    const raw = JSON.parse(engine.save(fresh(), replay)) as Record<string, unknown>;
    raw['version'] = 1;
    expect(() => engine.load(JSON.stringify(raw))).toThrow(/version 1/);
  });
});
