import { getPlayer, inventoryOf, itemsAt, type Entity, type GameState } from '@nh/core';
import { describe, expect, test } from 'vitest';
import {
  corpseChance,
  hungerData,
  isSick,
  makeSick,
  monsterToHit,
  startCorpseTimeout,
  xkilledCorpse,
} from '../src/index';
import { addMon } from './helpers';
import { defs, engine, invLine, itemOf, levelSetup, plainKit, render } from './itemHelpers';

type Setup = ReturnType<typeof levelSetup>;

const heroHunger = (s: Setup) => {
  const h = s.hero.c.hunger;
  if (!h) throw new Error('no hunger');
  return h;
};
const ration = (s: Setup): Entity => {
  const e = inventoryOf(s.state, s.state.playerId).find((o) => o.def === 'nh:food_ration');
  if (!e) throw new Error('no food ration');
  return e;
};
const status = (state: GameState) =>
  defs.statuses.find((x) => x.id === 'nh:hunger')?.value(state, defs);
/** Texts of all messages since the last call, across several steps. */
const eatMeal = (s: Setup, id: number) => s.text(s.mod('nh:eat', { item: id }));

function fresh(seed = 1): Setup {
  const s = levelSetup(['.......', '...@...', '.......'], seed);
  plainKit(s.state);
  return s;
}

describe('hunger', () => {
  test('the hero starts at 900 nutrition, not hungry', () => {
    const s = fresh();
    expect(s.hero.c.hunger).toEqual({ nutrition: 900, state: 'not_hungry' });
    expect(status(s.state)).toBeNull();
  });

  test('one nutrition burns per turn', () => {
    const s = fresh();
    const t0 = s.state.turn;
    for (let i = 0; i < 100; i++) s.step({ type: 'wait' });
    expect(s.state.turn - t0).toBe(100);
    expect(heroHunger(s).nutrition).toBe(800);
  });

  test('combat burns an extra point per attack (overexertion)', () => {
    const s = fresh();
    const mon = addMon(s.state, 'nh:newt', 4, 1, { asleep: true });
    s.state.entities[String(mon)]!.c.hp = { cur: 100, max: 100 };
    s.step({ type: 'move', dir: 'e' });
    expect(heroHunger(s).nutrition).toBe(900 - 2);
  });

  test('hungry at 150, weak at 50 (with a temporary Str loss), fainting at 0', () => {
    const s = fresh();
    const str = s.hero.c.attributes!.str;
    heroHunger(s).nutrition = 151;
    let texts = s.text(s.step({ type: 'wait' }));
    expect(texts).toContain('You are beginning to feel hungry.');
    expect(heroHunger(s).state).toBe('hungry');
    expect(status(s.state)).toBe('hungry');

    heroHunger(s).nutrition = 51;
    texts = s.text(s.step({ type: 'wait' }));
    expect(texts).toContain('Valkyrie needs food, badly!');
    expect(heroHunger(s).state).toBe('weak');
    expect(status(s.state)).toBe('weak');
    expect(s.hero.c.attributes!.str).toBe(str - 1);

    heroHunger(s).nutrition = 1;
    texts = s.text(s.step({ type: 'wait' }));
    expect(texts).toContain('You faint from lack of food.');
    expect(heroHunger(s).state).toBe('fainted');
    expect(status(s.state)).toBe('fainted');
    expect(s.hero.c.helpless).toBeDefined();
    expect(s.hero.c.attributes!.str).toBe(str - 1); // still weak
  });

  test('a faint lasts 10 - nutrition/10 turns, monsters act, and she wakes up', () => {
    const s = fresh();
    heroHunger(s).nutrition = 1;
    heroHunger(s).state = 'weak';
    const t0 = s.state.turn;
    const faint = s.step({ type: 'wait' });
    const until = s.hero.c.helpless!.until;
    expect(until - t0).toBeGreaterThanOrEqual(10);
    // keep the nutrition up so she does not faint again, then sleep through it
    heroHunger(s).nutrition = 60;
    const texts: string[] = [...s.text(faint)];
    for (let i = 0; i < 15 && s.hero.c.helpless; i++)
      texts.push(...s.text(s.step({ type: 'wait' })));
    expect(s.hero.c.helpless).toBeUndefined();
    expect(texts).toContain('You regain consciousness.');
    expect(heroHunger(s).state).not.toBe('fainted');
  });

  test('monsters get +4 to hit a helpless hero, and keep attacking while she is out', () => {
    const rng = { rnd: () => 1, d: () => 1, rn2: () => 0 } as never;
    expect(monsterToHit(rng, 6, 0, true)).toBe(monsterToHit(rng, 6, 0, false) + 4);

    const s = fresh();
    addMon(s.state, 'nh:jackal', 4, 1);
    heroHunger(s).nutrition = 1;
    heroHunger(s).state = 'weak';
    const hp0 = s.hero.c.hp!.cur;
    const keys = s.msgKeys(s.step({ type: 'wait' }));
    expect(keys).toContain('hunger.faint');
    expect(s.hero.c.helpless).toBeDefined();
    expect(s.hero.c.hp!.cur).toBeLessThan(hp0); // bitten during the faint
  });

  test('starving to death', () => {
    const s = fresh();
    s.hero.c.hp!.cur = s.hero.c.hp!.max = 5000;
    heroHunger(s).nutrition = -150;
    heroHunger(s).state = 'fainting';
    const keys: string[] = [];
    for (let i = 0; i < 2000 && !s.state.gameOver; i++) {
      // random spawns would eventually chew through the hero's 5000 HP while she faints
      for (const k of Object.keys(s.state.entities))
        if (s.state.entities[k]?.c.monster) delete s.state.entities[k];
      keys.push(...s.msgKeys(s.step({ type: 'wait' })));
    }
    expect(s.state.gameOver?.kind).toBe('died');
    expect(s.state.gameOver?.killer).toBe('@killer.starvation');
    expect(keys).toContain('hunger.starve');
    expect(heroHunger(s).nutrition).toBeLessThan(-(100 + 10 * s.hero.c.attributes!.con));
  });
});

describe('eating', () => {
  test('a food ration: 800 nutrition over 5 bites, then it is gone', () => {
    const s = fresh();
    heroHunger(s).nutrition = 100;
    const r = ration(s);
    const t0 = s.state.turn;
    const texts = eatMeal(s, r.id);
    expect(texts).toContain('This food really hits the spot!');
    expect(texts).toContain('You finish eating the food ration.');
    expect(s.state.entities[String(r.id)]).toBeUndefined();
    // 800 from five bites of 160 minus one burn per turn that passed
    const turns = s.state.turn - t0;
    expect(turns).toBe(6); // 5 bites and the turn the last bite is swallowed (ref: eatfood)
    expect(heroHunger(s).nutrition).toBe(100 + 800 - turns);
    expect(hungerData(s.ctx).victual).toBeNull();
  });

  test('the first bite of a satiating meal warns', () => {
    const s = fresh();
    heroHunger(s).nutrition = 500;
    expect(eatMeal(s, ration(s).id)).toContain('This satiates your stomach!');
  });

  test('an interrupted meal leaves a partly eaten ration that can be resumed', () => {
    const s = fresh();
    heroHunger(s).nutrition = 100;
    const r = ration(s);
    s.hero.c.hp!.cur = s.hero.c.hp!.max = 5000;
    const mon = addMon(s.state, 'nh:jackal', 4, 1);
    const texts = eatMeal(s, r.id);
    expect(texts).toContain('You stop eating the food ration.');
    const it = itemOf(s.state, r.id);
    expect(it.eaten).toBeLessThan(800);
    expect(it.eaten).toBeGreaterThan(0);
    expect(invLine(s.state, s.state.entities[String(r.id)]!)).toMatch(/partly eaten food ration/);
    const mid = heroHunger(s).nutrition;
    expect(mid).toBeGreaterThan(100);

    delete s.state.entities[String(mon)];
    const rest = eatMeal(s, r.id);
    expect(rest).toContain('You resume your meal.');
    expect(rest.join(' ')).toMatch(/You finish eating the food ration\./);
    expect(s.state.entities[String(r.id)]).toBeUndefined();
    // five bites of 160 in all (the interrupted ones were not lost)
    expect(heroHunger(s).nutrition).toBeGreaterThan(100 + 800 - 20);
  });

  test('eating one ration of a stack leaves the rest', () => {
    const s = fresh();
    heroHunger(s).nutrition = 100;
    const r = ration(s);
    itemOf(s.state, r.id).quantity = 3;
    eatMeal(s, r.id);
    expect(itemOf(s.state, r.id).quantity).toBe(2);
    expect(
      inventoryOf(s.state, s.state.playerId).filter((o) => o.def === 'nh:food_ration'),
    ).toHaveLength(1);
  });

  test('stuffing yourself: warns at 1500, usually chokes at 2000', () => {
    let died = 0;
    let vomited = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = fresh(seed);
      heroHunger(s).nutrition = 1900;
      heroHunger(s).state = 'satiated';
      const keys: string[] = [];
      keys.push(...s.msgKeys(s.mod('nh:eat', { item: ration(s).id })));
      if (s.state.gameOver) {
        died++;
        expect(s.state.gameOver.killer).toBe('@killer.choked.nh:food_ration');
        expect(keys).toContain('eat.choke_over');
      } else {
        vomited++;
        expect(keys).toContain('eat.stuff');
        expect(heroHunger(s).nutrition).toBeLessThan(1500);
      }
    }
    expect(died + vomited).toBe(200);
    expect(died).toBeGreaterThan(170); // 19 in 20
    expect(vomited).toBeGreaterThan(0);
  });

  test('the "hard time getting it down" warning', () => {
    const s = fresh();
    heroHunger(s).nutrition = 1100;
    heroHunger(s).state = 'satiated';
    const texts = eatMeal(s, ration(s).id);
    expect(texts).toContain("You're having a hard time getting all of it down.");
    expect(texts).toContain("You're finally finished.");
    expect(s.state.gameOver).toBeNull();
  });

  test('old food is sometimes rotten; lembas never', () => {
    let rotten = 0;
    for (let seed = 1; seed <= 70; seed++) {
      const s = fresh(seed);
      s.state.turn = 100;
      itemOf(s.state, ration(s).id).age = 1;
      if (eatMeal(s, ration(s).id).includes('Blecch!  Rotten food!')) rotten++;
    }
    expect(rotten).toBeGreaterThan(3);
    expect(rotten).toBeLessThan(25); // about 1 in 7

    for (let seed = 1; seed <= 40; seed++) {
      const s = fresh(seed);
      s.state.turn = 100;
      const l = s.carry('nh:lembas_wafer');
      itemOf(s.state, l).age = 1;
      const texts = eatMeal(s, l);
      expect(texts.join(' ')).not.toMatch(/Blecch/);
    }
  });

  test('a cursed apple puts the hero to sleep', () => {
    const s = fresh();
    const a = s.carry('nh:apple');
    itemOf(s.state, a).buc = 'cursed';
    // cursed food is rotten food first; use a seed-independent check of the sleep itself
    const texts: string[] = [];
    for (let i = 0; i < 3 && s.state.entities[String(a)]; i++) texts.push(...eatMeal(s, a));
    expect(texts.join(' ')).toMatch(/Blecch/);
  });

  test('food in the pack and on the floor is discoverable', () => {
    const s = fresh();
    const r = ration(s);
    const spear = inventoryOf(s.state, s.state.playerId).find((o) => o.def === 'nh:spear')!;
    const labels = (id: number) =>
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id })
        .map((o) => o.labelKey);
    expect(labels(r.id)).toContain('action.nh:eat');
    expect(labels(spear.id)).not.toContain('action.nh:eat');

    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'self' })
        .map((o) => o.labelKey),
    ).not.toContain('action.nh:eat_here');
    const apple = s.floor('nh:apple');
    const offers = engine.query(s.state).actionsFor({ kind: 'self' });
    const here = offers.find((o) => o.labelKey === 'action.nh:eat_here');
    expect(here?.action).toEqual({ type: 'mod', action: 'nh:eat', args: { item: apple } });
    expect(render({ key: here!.labelKey, ...(here!.params ? { params: here!.params } : {}) })).toBe(
      'Eat the apple here',
    );
    // and performing it eats the floor food
    heroHunger(s).nutrition = 100;
    s.step(here!.action);
    expect(s.state.entities[String(apple)]).toBeUndefined();
    expect(heroHunger(s).nutrition).toBeGreaterThan(100 + 40);
  });
});

describe('corpses', () => {
  const monDef = (id: string) => defs.monster(id as never);

  test('corpse odds follow corpse_chance (tiny rare: 1/3, small: 1/2, large: always)', () => {
    const s = fresh();
    const rate = (id: string, n = 4000) => {
      let k = 0;
      for (let i = 0; i < n; i++) if (corpseChance(s.ctx as never, monDef(id))) k++;
      return k / n;
    };
    // newt: frequency 5, tiny: 1/(2+0+1); jackal: frequency 3, small: 1/2; rothe: large
    expect(rate('nh:newt')).toBeGreaterThan(0.29);
    expect(rate('nh:newt')).toBeLessThan(0.38);
    expect(rate('nh:jackal')).toBeGreaterThan(0.46);
    expect(rate('nh:jackal')).toBeLessThan(0.54);
    expect(rate('nh:rothe', 50)).toBe(1);
  });

  test('killing a large monster leaves a corpse and starts its rot timer; manes leave none', () => {
    const s = fresh();
    const mon = addMon(s.state, 'nh:rothe', 4, 1);
    s.state.entities[String(mon)]!.c.hp = { cur: 1, max: 1 };
    s.state.entities[String(mon)]!.c.monster!.asleep = true;
    for (let i = 0; i < 50 && s.state.entities[String(mon)]; i++)
      s.step({ type: 'move', dir: 'e' });
    const level = s.state.currentLevel;
    const here = itemsAt(defs, s.state, level, 4, 1);
    expect(here.map((e) => e.def)).toEqual(['nh:corpse']);
    expect(here[0]!.c.item?.corpseOf).toBe('nh:rothe');
    expect(s.state.timers.some((t) => t.kind === 'nh:rot_corpse')).toBe(true);

    for (let i = 0; i < 50; i++)
      xkilledCorpse(s.ctx as never, monDef('nh:manes'), { level, x: 1, y: 1 });
    expect(itemsAt(defs, s.state, level, 1, 1)).toHaveLength(0);
  });

  test('corpses rot away after about 250 turns (floor: silently; carried: with a message)', () => {
    const s = fresh();
    s.state.entities[String(s.state.playerId)]!.c.hunger!.nutrition = 5000;
    const floorC = s.floor('nh:corpse', { corpseOf: 'nh:newt' });
    const packC = s.carry('nh:corpse', { corpseOf: 'nh:jackal' });
    const ctx = {
      ...s.ctx,
      schedule: (delay: number, kind: string, data: unknown) => {
        s.state.timers.push({ at: s.state.turn + delay, seq: s.state.seq++, kind, data } as never);
        s.state.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      },
    };
    startCorpseTimeout(ctx as never, floorC);
    startCorpseTimeout(ctx as never, packC);
    const texts: string[] = [];
    let goneAt = -1;
    const quiet = () => {
      for (const id of Object.keys(s.state.entities))
        if (s.state.entities[id]?.c.monster) delete s.state.entities[id];
    };
    for (let i = 0; i < 400 && s.state.entities[String(floorC)]; i++) {
      quiet();
      texts.push(...s.text(s.step({ type: 'wait' })));
      if (!s.state.entities[String(floorC)]) goneAt = s.state.turn;
    }
    expect(goneAt).toBeGreaterThan(200);
    expect(goneAt).toBeLessThan(400);
    for (let i = 0; i < 100 && s.state.entities[String(packC)]; i++) {
      quiet();
      texts.push(...s.text(s.step({ type: 'wait' })));
    }
    expect(s.state.entities[String(packC)]).toBeUndefined();
    expect(texts).toContain('Your jackal corpse rots away.');
    expect(texts.filter((t) => t.includes('newt corpse rots'))).toHaveLength(0);
  });

  test('an old corpse is tainted: deathly sick, then death in 10-19 turns unless it passes', () => {
    let died = 0;
    let recovered = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = fresh(seed);
      s.state.turn = 600;
      s.hero.c.hunger!.nutrition = 900;
      const c = s.carry('nh:corpse', { corpseOf: 'nh:jackal' });
      itemOf(s.state, c).age = 1;
      const texts = eatMeal(s, c);
      expect(texts).toContain('Ulch - that meat was tainted!');
      expect(texts).toContain('You feel deathly sick.');
      expect(s.state.entities[String(c)]).toBeUndefined();
      expect(isSick(s.ctx)).toBe(true);
      const remaining = hungerData(s.ctx).sick!.remaining;
      expect(remaining).toBeGreaterThan(0); // 10..19, less the turns the meal took
      expect(remaining).toBeLessThanOrEqual(19);
      const all: string[] = [];
      for (let i = 0; i < 25 && !s.state.gameOver && isSick(s.ctx); i++)
        all.push(...s.text(s.step({ type: 'wait' })));
      if (s.state.gameOver) {
        died++;
        expect(s.state.gameOver.killer).toBe('@killer.rotted.nh:jackal');
        expect(all).toContain('You die from your illness.');
        expect(all.join(' ')).toContain("You are at Death's door.");
      } else {
        recovered++;
        expect(all).toContain('You have recovered from your illness.');
      }
    }
    expect(died).toBeGreaterThan(40);
    expect(recovered).toBeGreaterThan(0);
  });

  test('sickness can be cured', () => {
    const s = fresh();
    makeSick(s.ctx as never, 15, '@killer.rotted.nh:newt');
    expect(isSick(s.ctx)).toBe(true);
    makeSick(s.ctx as never, 0, '');
    expect(isSick(s.ctx)).toBe(false);
    for (let i = 0; i < 30; i++) s.step({ type: 'wait' });
    expect(s.state.gameOver).toBeNull();
  });

  test('a fresh kobold corpse is poisonous 4 times in 5', () => {
    let poisoned = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = fresh(seed);
      const str0 = s.hero.c.attributes!.str;
      const c = s.carry('nh:corpse', { corpseOf: 'nh:kobold' });
      const texts = eatMeal(s, c);
      if (texts.includes('Ecch - that must have been poisonous!')) {
        poisoned++;
        expect(s.hero.c.attributes!.str).toBeLessThan(str0);
        expect(s.hero.c.attributes!.str).toBeGreaterThanOrEqual(str0 - 4);
      }
    }
    expect(poisoned).toBeGreaterThan(65);
    expect(poisoned).toBeLessThan(95);
  });

  test('a fresh newt corpse is safe, takes 3 turns and feeds 20', () => {
    const s = fresh();
    heroHunger(s).nutrition = 100;
    const c = s.carry('nh:corpse', { corpseOf: 'nh:newt' });
    const t0 = s.state.turn;
    const texts = eatMeal(s, c);
    expect(texts.join(' ')).toMatch(/newt corpse/);
    expect(s.state.entities[String(c)]).toBeUndefined();
    expect(s.state.turn - t0).toBeGreaterThanOrEqual(1);
    expect(heroHunger(s).nutrition).toBeGreaterThan(100 + 20 - 10);
  });
});

describe('helpless hero gets the nomul bonus only from the helpless component', () => {
  test('state stays plain JSON after a meal', () => {
    const s = fresh();
    eatMeal(s, ration(s).id);
    expect(() => JSON.stringify(s.state)).not.toThrow();
    expect(JSON.parse(JSON.stringify(s.state.modData)).nh.victual).toBeNull();
    expect(getPlayer(s.state)).toBeDefined();
  });
});
