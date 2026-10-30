import { itemsAt, type DefId, type EntityId, type GameState, type Pos } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { P_EXPERT, P_SKILLED, nhData } from '../src/index';
import { defs, engine, levelSetup as baseSetup, plainKit } from './itemHelpers';

/** The kit's BUC is random (blessed merges differently), so make it plain. */
function levelSetup(rows?: string[], seed?: number) {
  const s = baseSetup(rows, seed);
  plainKit(s.state);
  return s;
}

type Setup = ReturnType<typeof levelSetup>;

function spawn(state: GameState, defId: string, pos: Pos, hp = 3, asleep = false): EntityId {
  const d = defs.monster(defId as DefId);
  const id = state.nextEntityId++;
  state.entities[String(id)] = {
    id,
    def: defId as DefId,
    c: {
      pos: { level: 'dlvl1', ...pos },
      actor: { energy: 0, speed: d.speed },
      hp: { cur: hp, max: hp },
      monster: { level: d.level, peaceful: false, asleep, lastHero: null },
    },
  };
  return id;
}

const dagger = (s: Setup) => s.byLetter('b');
/** Starts a throw and answers the direction prompt. */
function throwDir(s: Setup, id: EntityId, dir: string) {
  const ask = s.mod('nh:throw', { item: id });
  const prompt = s.state.pendingPrompt?.prompt;
  if (!prompt) throw new Error('no prompt');
  expect(ask.events.some((e) => e.type === 'msg')).toBe(false);
  return engine.step(s.state, { type: 'answer', promptId: prompt.id, value: dir });
}
const floorAt = (s: Setup, x: number, y: number) =>
  itemsAt(defs, s.state, 'dlvl1', x, y).map((e) => e.def);
const ROW = ['.............', '......@......', '.............'];

describe('throw: the prompt and discoverability', () => {
  test('asks for a direction with the eight directions as menu options', () => {
    const s = levelSetup(ROW);
    const turn = s.state.turn;
    s.mod('nh:throw', { item: dagger(s) });
    const p = s.state.pendingPrompt?.prompt;
    expect(p?.kind).toBe('direction');
    expect(p?.options?.map((o) => o.value)).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
    expect(p?.options?.map((o) => o.key)).toEqual(
      ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((d) => `dir.${d}`),
    );
    expect(s.state.turn).toBe(turn); // nothing yet
    engine.step(s.state, { type: 'answer', promptId: p?.id ?? '', value: 'e' });
    expect(s.state.turn).toBe(turn + 1); // one move
  });

  test('offered on carried items except worn armor and a known-cursed wielded weapon', () => {
    const s = levelSetup(ROW);
    const offers = (id: EntityId) =>
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id })
        .flatMap((o) => (o.action.type === 'mod' ? [o.action.action as string] : []));
    expect(offers(dagger(s))).toContain('nh:throw');
    expect(offers(s.byLetter('a'))).toContain('nh:throw'); // the wielded spear
    expect(offers(s.byLetter('d'))).toContain('nh:throw'); // food ration
    expect(offers(s.byLetter('c'))).not.toContain('nh:throw'); // worn shield
    const sp = s.state.entities[String(s.byLetter('a'))]?.c.item;
    if (sp) {
      sp.buc = 'cursed';
      sp.known.buc = false;
    }
    expect(offers(s.byLetter('a'))).toContain('nh:throw'); // unknown curse
    if (sp) sp.known.buc = true;
    expect(offers(s.byLetter('a'))).not.toContain('nh:throw');
  });

  test('a cursed wielded weapon is welded: it cannot be thrown', () => {
    const s = levelSetup(ROW);
    const spearId = s.byLetter('a');
    const sp = s.state.entities[String(spearId)]?.c.item;
    if (sp) sp.buc = 'cursed';
    const r = throwDir(s, spearId, 'e');
    expect(s.text(r)).toContain('Your spear is welded to your hand!');
    expect(s.state.entities[String(spearId)]?.c.item?.carriedBy).toBe(s.state.playerId);
    expect(s.state.entities[String(spearId)]?.c.item?.known.buc).toBe(true);
  });

  test('invalid answers and worn armor throw nothing', () => {
    const s = levelSetup(ROW);
    const turn = s.state.turn;
    const r = throwDir(s, s.byLetter('c'), 'e');
    expect(s.text(r)).toContain('You cannot throw something you are wearing.');
    expect(s.state.turn).toBe(turn);
    const t2 = levelSetup(ROW);
    t2.mod('nh:throw', { item: dagger(t2) });
    const prompt = t2.state.pendingPrompt?.prompt;
    engine.step(t2.state, { type: 'answer', promptId: prompt?.id ?? '', value: 'up' });
    expect(t2.state.entities[String(dagger(t2))]?.c.item?.carriedBy).toBe(t2.state.playerId);
  });
});

describe('throw: flight', () => {
  test('hits or misses an adjacent monster; the dagger lands on its square either way', () => {
    let hits = 0;
    let misses = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = levelSetup(ROW, seed);
      const mon = spawn(s.state, 'nh:newt', { x: 7, y: 1 }, 1000);
      const d = dagger(s);
      const r = throwDir(s, d, 'e');
      const text = s.text(r);
      expect(floorAt(s, 7, 1)).toEqual(['nh:dagger']);
      expect(s.state.entities[String(mon)]).toBeDefined();
      if (text.some((t) => t === 'The dagger misses the newt.')) misses++;
      else {
        expect(text.some((t) => /^The dagger hits the newt[.!]$/.test(t))).toBe(true);
        expect(s.state.entities[String(mon)]?.c.hp?.cur).toBeLessThan(1000);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(10);
    expect(misses).toBeGreaterThan(0);
  });

  test('to-hit is -1 + AC + level + distance bonus + size + 2 (throwing weapon) + hitval', () => {
    // hero L1 Dex 14 (no bonus): newt AC 8, small (-1): at distance 1: -1+8+1+2-1+2 = 11 => hit on rnd(20) <= 11
    const rate = (dist: number) => {
      let hit = 0;
      const N = 300;
      for (let seed = 1; seed <= N; seed++) {
        const s = levelSetup(['....................', '..@.................'], seed);
        const hero = s.state.entities[String(s.state.playerId)];
        if (hero?.c.attributes) hero.c.attributes.dex = 14;
        spawn(s.state, 'nh:newt', { x: 2 + dist, y: 1 }, 1000);
        const r = throwDir(s, dagger(s), 'e');
        if (s.text(r).some((t) => t.includes('hits'))) hit++;
      }
      return hit / N;
    };
    expect(rate(1)).toBeGreaterThan(0.42);
    expect(rate(1)).toBeLessThan(0.68); // 11 / 20 = 0.55
    expect(rate(4)).toBeLessThan(rate(1) - 0.1); // 3 - 4 = -1 against 2
  }, 30_000);

  test('a distant monster is hit within range; the dagger flies past a miss only if nothing blocks', () => {
    const s = levelSetup(['..@..........'], 3);
    spawn(s.state, 'nh:newt', { x: 6, y: 0 }, 1000, true);
    throwDir(s, dagger(s), 'e');
    expect(floorAt(s, 6, 0)).toEqual(['nh:dagger']);
  });

  test('range is Str / 2 - weight / 40: the dagger drops short of a faraway monster', () => {
    const s = levelSetup(['..@...........'], 3);
    const hero = s.state.entities[String(s.state.playerId)];
    if (hero?.c.attributes) hero.c.attributes.str = 12; // range 6
    const mon = spawn(s.state, 'nh:newt', { x: 12, y: 0 }, 5);
    const r = throwDir(s, dagger(s), 'e');
    expect(floorAt(s, 8, 0)).toEqual(['nh:dagger']);
    expect(s.state.entities[String(mon)]?.c.hp?.cur).toBe(5);
    expect(s.text(r).some((t) => t.includes('newt'))).toBe(false);
  });

  test('a heavy object has a shorter range (at least 1)', () => {
    const s = levelSetup(['..@...........'], 3);
    const hero = s.state.entities[String(s.state.playerId)];
    if (hero?.c.attributes) hero.c.attributes.str = 12; // urange 6
    const ration = s.byLetter('d'); // weight 20: 6 - 0
    throwDir(s, ration, 'e');
    expect(floorAt(s, 8, 0)).toEqual(['nh:food_ration']);
    const t = levelSetup(['..@...........'], 3);
    const h2 = t.state.entities[String(t.state.playerId)];
    if (h2?.c.attributes) h2.c.attributes.str = 6; // urange 3, spear weight 30 -> 3
    throwDir(t, t.byLetter('a'), 'e');
    expect(floorAt(t, 5, 0)).toEqual(['nh:spear']);
  });

  test('a wall stops it: it lands on the last open square', () => {
    const s = levelSetup(['..@..']);
    throwDir(s, dagger(s), 'e');
    expect(floorAt(s, 4, 0)).toEqual(['nh:dagger']);
    const t = levelSetup(['..@..']);
    throwDir(t, dagger(t), 'n'); // out of the map
    expect(floorAt(t, 2, 0)).toEqual(['nh:dagger']);
  });

  test('diagonals work', () => {
    const s = levelSetup(['.....', '.....', '..@..', '.....', '.....']);
    throwDir(s, dagger(s), 'ne');
    expect(floorAt(s, 4, 0)).toEqual(['nh:dagger']);
  });

  test('a thrown stack item comes off the stack one at a time', () => {
    const s = levelSetup(ROW);
    const hero = s.state.entities[String(s.state.playerId)];
    if (hero?.c.attributes) hero.c.attributes.str = 8; // range 4
    const d = s.carry('nh:knife', { quantity: 3 });
    const before = s.state.entities[String(d)]?.c.item?.quantity;
    throwDir(s, d, 'w');
    expect(before).toBe(3);
    expect(s.state.entities[String(d)]?.c.item?.quantity).toBe(2);
    expect(floorAt(s, 2, 1)).toEqual(['nh:knife']);
  });

  test('throwing the wielded weapon unwields it', () => {
    const s = levelSetup(ROW);
    const hero = s.state.entities[String(s.state.playerId)];
    if (hero?.c.attributes) hero.c.attributes.str = 8; // range 4
    const sp = s.byLetter('a');
    throwDir(s, sp, 'e');
    const wielded = engine
      .query(s.state)
      .actionsFor({ kind: 'item', id: s.byLetter('b') })
      .some((o) => o.action.type === 'mod' && o.action.action === 'nh:wield');
    expect(wielded).toBe(true);
    expect(floorAt(s, 10, 1)).toEqual(['nh:spear']);
  });

  test('a landed dagger merges with the daggers already there', () => {
    const s = levelSetup(['..@...']);
    s.give('nh:dagger', { at: { level: 'dlvl1', x: 5, y: 0 } });
    throwDir(s, dagger(s), 'e');
    const here = itemsAt(defs, s.state, 'dlvl1', 5, 0);
    expect(here).toHaveLength(1);
    expect(here[0]?.c.item?.quantity).toBe(2);
  });
});

describe('throw: multishot', () => {
  const setSkill = (s: Setup, level: number) => {
    const d = nhData(s.ctx);
    if (d.skills) d.skills['dagger'] = level;
  };

  test('Basic skill throws one at a time', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = levelSetup(ROW, seed);
      const d = s.carry('nh:dagger', { quantity: 5 }); // merges with the kit's dagger: 6
      const stack = s.state.entities[String(d)]?.c.item;
      expect(stack?.quantity).toBe(6);
      throwDir(s, d, 'e');
      expect(stack?.quantity).toBe(5);
    }
  });

  test('Skilled throws 1 or 2, Expert 1 to 3, with a message', () => {
    const run = (skill: number) => {
      const seen = new Map<number, number>();
      let msgSeen = false;
      for (let seed = 1; seed <= 80; seed++) {
        const s = levelSetup(ROW, seed);
        setSkill(s, skill);
        const d = s.carry('nh:dagger', { quantity: 6 }); // 7 with the kit's
        const r = throwDir(s, d, 'e');
        const thrown = 7 - (s.state.entities[String(d)]?.c.item?.quantity ?? 0);
        seen.set(thrown, (seen.get(thrown) ?? 0) + 1);
        if (thrown > 1) {
          expect(s.text(r)).toContain(`You throw ${thrown} daggers.`);
          msgSeen = true;
        } else expect(s.text(r).some((t) => t.startsWith('You throw'))).toBe(false);
        // all land on the same far square (nothing in the way)
        expect(
          itemsAt(defs, s.state, 'dlvl1', 12, 1).reduce((n, e) => n + (e.c.item?.quantity ?? 0), 0),
        ).toBe(thrown);
        expect(s.state.turn).toBe(2); // one move whatever the volley (the game starts on turn 1)
      }
      return { seen, msgSeen };
    };
    const skilled = run(P_SKILLED);
    expect([...skilled.seen.keys()].sort()).toEqual([1, 2]);
    expect(skilled.msgSeen).toBe(true);
    const expert = run(P_EXPERT);
    expect([...expert.seen.keys()].sort()).toEqual([1, 2, 3]);
  });

  test('never more than the stack, and Dex 6 or less gets no volley bonus', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = levelSetup(ROW, seed);
      setSkill(s, P_EXPERT);
      const d = s.carry('nh:dagger', { quantity: 1 }); // 2 with the kit's
      throwDir(s, d, 'e');
      const left = s.state.entities[String(d)]?.c.item?.quantity ?? 0;
      expect(left === 0 || left === 1).toBe(true);
    }
    for (let seed = 1; seed <= 40; seed++) {
      const s = levelSetup(ROW, seed);
      const hero = s.state.entities[String(s.state.playerId)];
      if (hero?.c.attributes) hero.c.attributes.dex = 6;
      setSkill(s, P_SKILLED);
      const d = s.carry('nh:dagger', { quantity: 5 }); // 6
      throwDir(s, d, 'e');
      expect(s.state.entities[String(d)]?.c.item?.quantity).toBe(5);
    }
  });

  test('a volley names the shots ("the 2nd dagger")', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = levelSetup(ROW, seed);
      setSkill(s, P_SKILLED);
      spawn(s.state, 'nh:newt', { x: 8, y: 1 }, 1000);
      const d = s.carry('nh:dagger', { quantity: 6 });
      const r = throwDir(s, d, 'e');
      const text = s.text(r);
      if (text.some((t) => t.startsWith('You throw 2 daggers.'))) {
        expect(text.some((t) => /^The (1st|2nd) dagger (hits|misses) the newt[.!]?$/.test(t))).toBe(
          true,
        );
        return;
      }
    }
    throw new Error('no volley seen');
  });
});

describe('throw: kills', () => {
  test('a kill removes the monster and awards experience', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = levelSetup(ROW, seed);
      const mon = spawn(s.state, 'nh:newt', { x: 7, y: 1 }, 1, true);
      const xp = s.state.entities[String(s.state.playerId)]?.c.experience;
      const before = xp?.points ?? 0;
      const r = throwDir(s, dagger(s), 'e');
      if (s.state.entities[String(mon)]) continue; // missed
      expect(s.text(r)).toContain('You kill the newt!');
      expect(xp?.points).toBeGreaterThan(before);
      expect(floorAt(s, 7, 1)).toContain('nh:dagger');
      return;
    }
    throw new Error('never hit');
  });

  test('a hit wakes a sleeping monster', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = levelSetup(ROW, seed);
      const mon = spawn(s.state, 'nh:newt', { x: 7, y: 1 }, 1000, true);
      const r = throwDir(s, dagger(s), 'e');
      if (s.text(r).some((t) => t.includes('hits'))) {
        expect(s.state.entities[String(mon)]?.c.monster?.asleep).toBe(false);
        return;
      }
    }
    throw new Error('never hit');
  });

  test('is deterministic for a seed', () => {
    const run = () => {
      const s = levelSetup(ROW, 7);
      spawn(s.state, 'nh:newt', { x: 8, y: 1 }, 5);
      const r = throwDir(s, dagger(s), 'e');
      return JSON.stringify([s.text(r), s.state.rng]);
    };
    expect(run()).toBe(run());
  });
});

describe('throw: the projectile event', () => {
  type Proj = Extract<import('@nh/core').GameEvent, { type: 'projectile' }>;
  const projs = (r: { events: import('@nh/core').GameEvent[] }): Proj[] =>
    r.events.filter((e): e is Proj => e.type === 'projectile');

  test('lists the seen cells in order, ends where it lands, and comes before the messages', () => {
    const s = levelSetup(ROW);
    spawn(s.state, 'nh:newt', { x: 9, y: 1 }, 1000);
    const r = throwDir(s, dagger(s), 'e');
    const p = projs(r);
    expect(p).toHaveLength(1);
    expect(p[0]?.g).toBe('nh:dagger');
    expect(p[0]?.path).toEqual([
      { x: 7, y: 1 },
      { x: 8, y: 1 },
      { x: 9, y: 1 },
    ]);
    const i = r.events.findIndex((e) => e.type === 'projectile');
    const m = r.events.findIndex((e) => e.type === 'msg');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(m === -1 || i < m).toBe(true);
  });

  test('never lists unseen cells', () => {
    const s = levelSetup(ROW);
    const w = s.state.levels['dlvl1']?.width ?? 0;
    s.mod('nh:throw', { item: dagger(s) }); // asks; vision is refreshed after this step
    s.state.visible = s.state.visible.filter((i) => i !== 1 * w + 8);
    const prompt = s.state.pendingPrompt?.prompt;
    const r = engine.step(s.state, { type: 'answer', promptId: prompt?.id ?? '', value: 'e' });
    const path = projs(r)[0]?.path ?? [];
    expect(path.some((c) => c.x === 8)).toBe(false);
    expect(path.length).toBeGreaterThan(0);
  });

  test('an unidentified object shows its appearance', () => {
    const s = levelSetup(ROW);
    const pot = s.carry('nh:potion_of_water');
    s.state.appearances['nh:potion_of_water'] = 'nh:potion_murky';
    const p = projs(throwDir(s, pot, 'e'))[0];
    expect(p?.g).toBe('nh:potion_murky');
  });

  test('a volley emits one event per missile', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = levelSetup(ROW, seed);
      const d = nhData(s.ctx);
      if (d.skills) d.skills['dagger'] = P_EXPERT;
      const id = s.carry('nh:dagger', { quantity: 6 });
      const r = throwDir(s, id, 'e');
      const thrown = 7 - (s.state.entities[String(id)]?.c.item?.quantity ?? 0);
      expect(projs(r)).toHaveLength(thrown);
      if (thrown > 1) return;
    }
    throw new Error('never a volley');
  });
});
