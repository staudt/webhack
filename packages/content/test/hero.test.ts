import {
  createEngine,
  createRng,
  getPlayer,
  type GameEvent,
  type GameState,
  type MonsterDef,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import { experienceFor, gainExperience, newuexp, vanillaMod } from '../src/index';

const engine = createEngine([vanillaMod]);
const fresh = (seed: number): GameState => engine.newGame({ seed }).state;
const heroOf = (s: GameState) => getPlayer(s);

/** Collects events emitted through a minimal ctx: only rng/state/emit are used by gainExperience. */
function gain(state: GameState, exp: number): GameEvent[] {
  const events: GameEvent[] = [];
  // ref: the engine's Ctx; gainExperience needs state, rng and emit only.
  const rng = rngFor(state);
  gainExperience(
    { state, rng, emit: (e: GameEvent) => events.push(e) } as never,
    state.playerId,
    exp,
  );
  return events;
}
function rngFor(state: GameState) {
  return createRng(state.rng.core);
}

const MAXES = [118, 18, 18, 18, 18, 18];

describe('newGame hero', () => {
  test('attributes obey bounds and the init_attr total', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const a = heroOf(fresh(seed)).c.attributes;
      expect(a).toBeDefined();
      if (!a) continue;
      const v = [a.str, a.int, a.wis, a.dex, a.con, a.cha];
      v.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(3);
        expect(x).toBeLessThanOrEqual(MAXES[i] ?? 18);
        // Valkyrie base is the floor before the +-2/4 variation (rn2(7)-2 in -2..4)
        expect(x).toBeGreaterThanOrEqual(([10, 7, 7, 7, 10, 7][i] ?? 0) - 2);
      });
      // 75 points distributed; vary_init_attr shifts each attribute with chance 1/20 by -2..+4.
      const sum = v.reduce((p, c) => p + c, 0);
      expect(sum).toBeGreaterThanOrEqual(75 - 12);
      expect(sum).toBeLessThanOrEqual(75 + 24);
    }
  });

  test('most seeds sum to exactly 75', () => {
    let exact = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const a = heroOf(fresh(seed)).c.attributes;
      if (a && a.str + a.int + a.wis + a.dex + a.con + a.cha === 75) exact++;
    }
    // P(no variation roll fires) = 0.95^6 ~ 0.735
    expect(exact).toBeGreaterThan(30);
  });

  test('hp is 14 (Valkyrie) + 2 (human) with no random part', () => {
    const hp = heroOf(fresh(7)).c.hp;
    expect(hp).toEqual({ cur: 16, max: 16 });
  });

  test('AC 6, level 1, spear stand-in', () => {
    const c = heroOf(fresh(7)).c;
    expect(c.gear?.ac).toBe(6);
    expect(c.gear?.weapon).toMatchObject({
      small: [1, 6],
      large: [1, 8],
      enchant: 1,
      skillBonus: 0,
    });
    expect(c.experience).toEqual({ level: 1, points: 0 });
  });

  test('deterministic per seed, varied across seeds', () => {
    expect(heroOf(fresh(42)).c).toEqual(heroOf(fresh(42)).c);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++)
      seen.add(JSON.stringify(heroOf(fresh(seed)).c.attributes));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('newuexp', () => {
  test('matches exper.c thresholds', () => {
    const expected = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10000, 20000, 40000];
    expected.forEach((v, i) => expect(newuexp(i + 1)).toBe(v));
    expect(newuexp(19)).toBe(5120000);
    expect(newuexp(20)).toBe(10000000);
    expect(newuexp(0)).toBe(0);
  });
});

describe('gainExperience', () => {
  test('crosses one threshold: +level, +hp, message', () => {
    const s = fresh(3);
    const hero = heroOf(s);
    const con = hero.c.attributes?.con ?? 10;
    const events = gain(s, 20);
    expect(hero.c.experience).toEqual({ level: 2, points: 20 });
    expect(events).toEqual([{ type: 'msg', key: 'exp.welcome', params: { level: 2 } }]);
    // newhp at ulevel 1: rnd(8)+rnd(2)+conplus, so 2..10 plus Con bonus
    const plus =
      con <= 3
        ? -2
        : con <= 6
          ? -1
          : con <= 14
            ? 0
            : con <= 16
              ? 1
              : con === 17
                ? 2
                : con === 18
                  ? 3
                  : 4;
    const gained = (hero.c.hp?.max ?? 0) - 16;
    expect(gained).toBeGreaterThanOrEqual(Math.max(1, 2 + plus));
    expect(gained).toBeLessThanOrEqual(10 + plus);
    expect(hero.c.hp?.cur).toBe(hero.c.hp?.max);
  });

  test('a huge award gives one level per call, capped below the next threshold', () => {
    const s = fresh(3);
    const hero = heroOf(s);
    gain(s, 1000);
    // pluslvl caps points at newuexp(2) - 1 = 39
    expect(hero.c.experience).toEqual({ level: 2, points: 39 });
    gain(s, 1); // 40 >= newuexp(2)
    expect(hero.c.experience).toEqual({ level: 3, points: 40 });
    gain(s, 1000); // capped at newuexp(4) - 1 = 159
    expect(hero.c.experience).toEqual({ level: 4, points: 159 });
    expect(hero.c.hp?.max ?? 0).toBeGreaterThan(16 + 2);
  });

  test('no level-up below the threshold, and level 30 is the cap', () => {
    const s = fresh(3);
    const hero = heroOf(s);
    expect(gain(s, 19)).toEqual([]);
    expect(hero.c.experience).toEqual({ level: 1, points: 19 });
    if (hero.c.experience) hero.c.experience.level = 30;
    gain(s, 99999999);
    expect(hero.c.experience?.level).toBe(30);
  });
});

const def = (o: Partial<MonsterDef>): MonsterDef => ({
  id: 'test:m',
  nameKey: 'x',
  glyph: { ch: 'x', fg: '#fff' },
  level: 0,
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
  brain: 'nh:x',
  ...o,
});

describe('experienceFor', () => {
  test('newt (level 0, speed 6, AC 8, bite 1d3) is 1', () => {
    const newt = def({
      level: 0,
      speed: 6,
      ac: 8,
      attacks: [{ at: 'bite', ad: 'phys', n: 1, d: 3 }],
    });
    expect(experienceFor(newt, 0)).toBe(1);
  });
  test('jackal (level 0, speed 12, AC 7, bite 1d2) is 1', () => {
    const jackal = def({ speed: 12, ac: 7, attacks: [{ at: 'bite', ad: 'phys', n: 1, d: 2 }] });
    expect(experienceFor(jackal, 0)).toBe(1);
  });
  test('soldier ant style: 1+9 level, +3 speed 18, +3 sting, +6 drst', () => {
    const ant = def({
      level: 3,
      speed: 18,
      ac: 3,
      attacks: [
        { at: 'bite', ad: 'phys', n: 2, d: 4 },
        { at: 'sting', ad: 'drst', n: 3, d: 4 },
      ],
    });
    expect(experienceFor(ant, 3)).toBe(22);
  });
  test('weapon attack, low AC, nasty, high level, heavy damage', () => {
    const m = def({
      level: 9,
      speed: 24,
      ac: -2,
      flags: ['nasty'],
      attacks: [{ at: 'weapon', ad: 'phys', n: 5, d: 5 }],
    });
    // 1+81 =82; ac -2: (7+2)*2=18 ->100; speed>18: +5 ->105; weapon +5 ->110;
    // damage 25>23: +9 ->119; nasty 7*9=63 ->182; level>8: +50 ->232
    expect(experienceFor(m, 9)).toBe(232);
  });
});

describe('HP regeneration', () => {
  const quiet = (s: GameState): void => {
    for (const id of Object.keys(s.entities)) if (Number(id) !== s.playerId) delete s.entities[id];
  };

  test('heals 1 per turn when level + Con >= 100', () => {
    const s = fresh(5);
    quiet(s);
    const hero = heroOf(s);
    if (hero.c.attributes) hero.c.attributes.con = 99;
    if (hero.c.hp) hero.c.hp.cur = 1;
    for (let i = 0; i < 10; i++) engine.step(s, { type: 'wait' });
    expect(hero.c.hp?.cur).toBe(11);
  });

  test('never exceeds max, and the statistical rate is (level+Con)%', () => {
    const s = fresh(5);
    quiet(s);
    const hero = heroOf(s);
    if (hero.c.attributes) hero.c.attributes.con = 14; // 15% per turn at level 1
    if (hero.c.hp) {
      hero.c.hp.max = 5000;
      hero.c.hp.cur = 1;
    }
    const turns = 1000;
    for (let i = 0; i < turns; i++) {
      for (const id of Object.keys(s.entities)) if (Number(id) !== s.playerId) delete s.entities[id];
      const before = hero.c.hp?.cur ?? 0;
      engine.step(s, { type: 'wait' });
      const after = hero.c.hp?.cur ?? 0;
      expect(after - before).toBeGreaterThanOrEqual(0);
      expect(after - before).toBeLessThanOrEqual(1);
    }
    const healed = (hero.c.hp?.cur ?? 0) - 1;
    expect(healed).toBeGreaterThan(turns * 0.15 * 0.7);
    expect(healed).toBeLessThan(turns * 0.15 * 1.3);
    if (hero.c.hp) {
      hero.c.hp.max = 16;
      hero.c.hp.cur = 15;
    }
    if (hero.c.attributes) hero.c.attributes.con = 99;
    for (let i = 0; i < 5; i++) engine.step(s, { type: 'wait' });
    expect(hero.c.hp?.cur).toBe(16);
  });
});
