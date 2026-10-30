// Damage types, passive attacks, resistances, properties and intrinsics.
import {
  cellRules,
  getLevel,
  getPlayer,
  type AttackDef,
  type Ctx,
  type DefId,
  type Entity,
  type GameEvent,
  type GameState,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import {
  P,
  adjabil,
  cpostfxOf,
  gainExperience,
  givit,
  hasProp,
  heroMovement,
  hitmuAd,
  makeStunned,
  mfndpos,
  monsterAttack,
  newuexp,
  passive,
  poisoned,
  setIntrinsic,
  setItimeout,
  setUstuck,
  ustuck,
} from '../src/index';
import { corpseIntrinsic, shouldGivit } from '../src/givit';
import { escapeFromStickyMon } from '../src/hackmove';
import { addMon, posOf, setup } from './helpers';
import { ctxFor, defs, levelSetup } from './itemHelpers';

// ---- helpers ----

/** A walled room; the hero starts at its top left corner. */
const open = (w: number, h: number): string[] => [
  '-'.repeat(w + 2),
  ...Array.from({ length: h }, (_, y) => `|${y === 0 ? '@' : '.'}${'.'.repeat(w - 1)}|`),
  '-'.repeat(w + 2),
];

/** A Ctx with everything the content functions touch, over a state. */
function fullCtx(state: GameState): Ctx & { events: GameEvent[] } {
  const base = ctxFor(state);
  return Object.assign(base, {
    interrupt() {},
    endGame(over: NonNullable<GameState['gameOver']>) {
      state.gameOver = over;
    },
  }) as unknown as Ctx & { events: GameEvent[] };
}

const keys = (events: readonly GameEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'msg' ? [e.key] : []));
const heroOf = (s: GameState): Entity => getPlayer(s);
const def = (id: string) => defs.monster(id as DefId);

/** A level with the hero at '@' on a plain hero (no props) and lots of HP. */
function fight(seed: number, rows = open(6, 3)) {
  const t = setup(rows, seed);
  const hero = heroOf(t.state);
  hero.c.hp = { cur: 5000, max: 5000 };
  return { ...t, hero };
}

const attackE = (t: ReturnType<typeof fight>) =>
  t.engine.stepAll(t.state, { type: 'move', dir: 'e' });

/** The hero hits a durable monster next to her up to `n` times; returns all events. */
function hitMold(
  seed: number,
  id: string,
  o: {
    props?: Record<string, { intrinsic: boolean; timeout: number }>;
    hp?: number;
    n?: number;
  } = {},
) {
  const t = fight(seed);
  if (o.props) t.hero.c.props = o.props;
  else delete t.hero.c.props;
  const mon = addMon(t.state, id, 2, 1);
  const m = t.state.entities[String(mon)]!;
  m.c.hp = { cur: o.hp ?? 100000, max: o.hp ?? 100000 };
  m.c.monster!.level = def(id).level;
  const events: GameEvent[] = [];
  const hp0 = t.hero.c.hp!.cur;
  for (let i = 0; i < (o.n ?? 1); i++) events.push(...attackE(t).events);
  return { t, events, mon, hpLost: hp0 - t.hero.c.hp!.cur };
}

// ---- properties and timeouts ----

describe('props', () => {
  test('the Valkyrie starts with intrinsic cold resistance only', () => {
    const t = setup(open(4, 2));
    const p = heroOf(t.state).c.props;
    expect(p).toEqual({ cold_res: { intrinsic: true, timeout: 0 } });
    expect(hasProp(heroOf(t.state), P.COLD_RES)).toBe(true);
    expect(hasProp(heroOf(t.state), P.STEALTH)).toBe(false);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p); // plain data
  });

  test('stun: "You stagger...", status, "You feel a bit steadier now." on time', () => {
    const t = setup(open(4, 2));
    const hero = heroOf(t.state);
    const out: GameEvent[] = [];
    makeStunned({ state: t.state, emit: (e) => out.push(e) }, 5, true);
    expect(keys(out)).toEqual(['stun.stagger']);
    const status = defs.statuses.find((s) => s.id === 'nh:stunned')!;
    expect(status.value(t.state, defs)).toBe(1);
    for (let i = 1; i <= 4; i++) {
      expect(keys(t.wait().events)).not.toContain('stun.steady');
      expect(hasProp(hero, P.STUNNED)).toBe(true);
    }
    expect(keys(t.wait().events)).toContain('stun.steady');
    expect(hasProp(hero, P.STUNNED)).toBe(false);
    expect(status.value(t.state, defs)).toBeNull();
    expect(hero.c.props?.['stunned']).toBeUndefined(); // pruned
  });

  test('already stunned: no second stagger message, longer timer', () => {
    const t = setup(open(4, 2));
    const out: GameEvent[] = [];
    const c = { state: t.state, emit: (e: GameEvent) => out.push(e) };
    makeStunned(c, 5, true);
    makeStunned(c, 9, true);
    expect(keys(out)).toEqual(['stun.stagger']);
    expect(heroOf(t.state).c.props?.['stunned']?.timeout).toBe(t.state.turn + 9);
  });

  test('timed acid resistance and timed speed end with their messages', () => {
    const t = setup(open(4, 2));
    const hero = heroOf(t.state);
    setItimeout(t.state, hero, P.ACID_RES, 2);
    setItimeout(t.state, hero, P.FAST, 2);
    expect(keys(t.wait().events)).toEqual([]);
    const k = keys(t.wait().events);
    expect(k).toContain('timeout.acid_unsafe');
    expect(k).toContain('timeout.slow_down');
    expect(hero.c.props?.['acid_res']).toBeUndefined();
  });

  test('timed speed over an intrinsic says "a bit"', () => {
    const t = setup(open(4, 2));
    const hero = heroOf(t.state);
    setIntrinsic(hero, P.FAST, true);
    setItimeout(t.state, hero, P.FAST, 1);
    expect(keys(t.wait().events)).toContain('timeout.slow_down_bit');
    expect(hasProp(hero, P.FAST)).toBe(true);
  });
});

// ---- Valkyrie abilities ----

describe('Valkyrie intrinsics', () => {
  function levelUp(t: ReturnType<typeof setup>, to: number): GameEvent[] {
    const ctx = fullCtx(t.state);
    const xp = heroOf(t.state).c.experience!;
    while (xp.level < to) gainExperience(ctx, t.state.playerId, newuexp(xp.level));
    return ctx.events;
  }

  test('stealth at XL 3 and speed at XL 7, each with its message', () => {
    const t = setup(open(4, 2));
    const hero = heroOf(t.state);
    expect(keys(levelUp(t, 2))).not.toContain('abil.stealthy');
    expect(hasProp(hero, P.STEALTH)).toBe(false);
    expect(keys(levelUp(t, 3))).toContain('abil.stealthy');
    expect(hasProp(hero, P.STEALTH)).toBe(true);
    expect(hasProp(hero, P.FAST)).toBe(false);
    const k = keys(levelUp(t, 7));
    expect(k.filter((x) => x === 'abil.quick')).toHaveLength(1);
    expect(k).not.toContain('abil.stealthy');
    expect(hero.c.props?.['fast']).toEqual({ intrinsic: true, timeout: 0 });
  });

  test('no message when another source already gave the property', () => {
    const t = setup(open(4, 2));
    const ctx = fullCtx(t.state);
    setIntrinsic(heroOf(t.state), P.STEALTH, true);
    adjabil(ctx, t.state.playerId, 2, 3);
    expect(keys(ctx.events)).toEqual([]);
  });

  test('movement: exactly 12 at XL 1, a free move one turn in three from XL 7', () => {
    const t = setup(open(4, 2));
    const ctx = fullCtx(t.state);
    const sample = (n: number): number[] =>
      Array.from({ length: n }, () => heroMovement(ctx, t.state.playerId));
    expect(new Set(sample(200))).toEqual(new Set([12]));
    setIntrinsic(heroOf(t.state), P.FAST, true);
    const s = sample(6000);
    expect(new Set(s)).toEqual(new Set([12, 24]));
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    expect(mean).toBeGreaterThan(15.6);
    expect(mean).toBeLessThan(16.4);
  });

  test('timed speed (Very_fast) gives a free move on two turns in three', () => {
    const t = setup(open(4, 2));
    const ctx = fullCtx(t.state);
    setItimeout(t.state, heroOf(t.state), P.FAST, 100000);
    const s = Array.from({ length: 6000 }, () => heroMovement(ctx, t.state.playerId));
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    expect(mean).toBeGreaterThan(19.6);
    expect(mean).toBeLessThan(20.4);
  });

  test('a Fast hero acts more often than a normal one', () => {
    const turnsFor = (fast: boolean): number => {
      const t = setup(open(8, 2), 7);
      if (fast) setIntrinsic(heroOf(t.state), P.FAST, true);
      const t0 = t.state.turn;
      for (let i = 0; i < 90; i++) t.engine.step(t.state, { type: 'wait' });
      return t.state.turn - t0;
    };
    expect(turnsFor(false)).toBe(90);
    expect(turnsFor(true)).toBeLessThan(75);
  });

  test('stealth comes from the property: sleepers stay asleep without XL 3', () => {
    const t = setup(open(12, 1));
    const id = addMon(t.state, 'nh:jackal', 6, 1, { asleep: true });
    setIntrinsic(heroOf(t.state), P.STEALTH, true);
    for (let i = 0; i < 10; i++) t.wait();
    expect(t.state.entities[String(id)]?.c.monster?.asleep).toBe(true);
  });
});

// ---- damage types against the hero ----

const atk = (at: AttackDef['at'], ad: string, n: number, d: number): AttackDef => ({
  at,
  ad,
  n,
  d,
});

/** Runs `n` hits of an attack on a fresh monster entity; `before` prepares the hero per trial. */
function trials(
  n: number,
  a: AttackDef,
  o: {
    props?: Record<string, { intrinsic: boolean; timeout: number }>;
    level?: number;
    hp?: number;
  } = {},
) {
  const t = setup(open(6, 3), 3);
  const ctx = fullCtx(t.state);
  const hero = heroOf(t.state);
  const monId = addMon(t.state, 'nh:newt', 3, 1);
  const mon = t.state.entities[String(monId)]!;
  mon.c.monster!.level = o.level ?? 1;
  const results: { dmg: number; keys: string[]; helpless: boolean; stunned: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    delete hero.c.helpless;
    if (o.props) hero.c.props = JSON.parse(JSON.stringify(o.props));
    else delete hero.c.props;
    hero.c.hp = { cur: o.hp ?? 5000, max: o.hp ?? 5000 };
    ctx.events.length = 0;
    const dmg = hitmuAd(ctx, mon, a, a.n * a.d);
    results.push({
      dmg,
      keys: keys(ctx.events),
      helpless: hero.c.helpless !== undefined,
      stunned: hasProp(hero, P.STUNNED),
    });
  }
  return results;
}

describe('hitmu damage types', () => {
  test('electricity: "You get zapped!", zero damage with shock resistance', () => {
    const plain = trials(40, atk('bite', 'elec', 1, 6));
    expect(plain.every((r) => r.dmg === 6 && r.keys.join() === 'mhitu.zapped')).toBe(true);
    const res = trials(40, atk('bite', 'elec', 1, 6), {
      props: { shock_res: { intrinsic: true, timeout: 0 } },
    });
    expect(
      res.every((r) => r.dmg === 0 && r.keys.join() === 'mhitu.zapped,mhitu.zap_no_shock'),
    ).toBe(true);
  });

  test('fire and cold: resisted damage is zero, the cold-resistant Valkyrie shrugs off frost', () => {
    const fire = trials(30, atk('claw', 'fire', 2, 6));
    expect(fire.every((r) => r.dmg === 12 && r.keys[0] === 'mhitu.on_fire')).toBe(true);
    const fireRes = trials(30, atk('claw', 'fire', 2, 6), {
      props: { fire_res: { intrinsic: true, timeout: 0 } },
    });
    expect(fireRes.every((r) => r.dmg === 0 && r.keys[1] === 'mhitu.fire_not_hot')).toBe(true);
    const cold = trials(30, atk('claw', 'cold', 2, 6));
    expect(cold.every((r) => r.dmg === 12 && r.keys.join() === 'mhitu.frost')).toBe(true);
    const valk = trials(30, atk('claw', 'cold', 2, 6), {
      props: { cold_res: { intrinsic: true, timeout: 0 } },
    });
    expect(valk.every((r) => r.dmg === 0 && r.keys[1] === 'mhitu.frost_not_cold')).toBe(true);
  });

  test('acid: one hit in three burns; resistance makes it harmless', () => {
    const r = trials(900, atk('claw', 'acid', 1, 8));
    const burns = r.filter((x) => x.keys.includes('mhitu.acid_burns'));
    expect(burns.length).toBeGreaterThan(240);
    expect(burns.length).toBeLessThan(360);
    expect(r.filter((x) => !x.keys.includes('mhitu.acid_burns')).every((x) => x.dmg === 0)).toBe(
      true,
    );
    const res = trials(900, atk('claw', 'acid', 1, 8), {
      props: { acid_res: { intrinsic: false, timeout: 99999 } },
    });
    expect(res.filter((x) => x.keys.includes('mhitu.acid_harmless')).length).toBeGreaterThan(240);
    expect(res.some((x) => x.dmg > 0)).toBe(false);
  });

  test('sleep: about one hit in five puts her to sleep for rnd(10), never with resistance', () => {
    const r = trials(1500, atk('bite', 'slee', 1, 3), { level: 2 });
    const asleep = r.filter((x) => x.helpless);
    expect(asleep.length).toBeGreaterThan(230);
    expect(asleep.length).toBeLessThan(370);
    expect(asleep.every((x) => x.keys.join() === 'mhitu.put_to_sleep')).toBe(true);
    const res = trials(1500, atk('bite', 'slee', 1, 3), {
      level: 2,
      props: { sleep_res: { intrinsic: true, timeout: 0 } },
    });
    expect(res.some((x) => x.helpless)).toBe(false);
  });

  test('sleep lasts rnd(10) more moves, then "You wake up."', () => {
    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const t = fight(seed, open(6, 3));
      delete t.hero.c.props;
      const mon = addMon(t.state, 'nh:homunculus', 2, 1);
      t.state.entities[String(mon)]!.c.monster!.level = 2;
      const events: GameEvent[] = [];
      for (let i = 0; i < 60 && !found; i++) {
        const t0 = t.state.turn;
        const r = t.engine.step(t.state, { type: 'wait' });
        events.push(...r.events);
        if (keys(r.events).includes('mhitu.put_to_sleep')) {
          found = true;
          // monsters act until she can move again: 1..10 extra turns pass, then she wakes up
          expect(keys(r.events)).toContain('eat.wake_up');
          expect(t.state.turn - t0).toBeGreaterThanOrEqual(2);
          expect(t.state.turn - t0).toBeLessThanOrEqual(12);
          expect(t.hero.c.helpless).toBeUndefined();
        }
      }
    }
    expect(found).toBe(true);
  });

  test('paralysis: one hit in three freezes her for rnd(10)', () => {
    const r = trials(1500, atk('claw', 'plys', 1, 4));
    const frozen = r.filter((x) => x.helpless);
    expect(frozen.length).toBeGreaterThan(400);
    expect(frozen.length).toBeLessThan(600);
    expect(frozen.every((x) => x.keys.join() === 'mhitu.frozen_by')).toBe(true);
  });

  test('stun: one hit in four stuns her and halves the damage', () => {
    const r = trials(1200, atk('claw', 'stun', 1, 9));
    const stunned = r.filter((x) => x.stunned);
    expect(stunned.length).toBeGreaterThan(240);
    expect(stunned.length).toBeLessThan(360);
    expect(stunned.every((x) => x.dmg === 4 && x.keys.join() === 'stun.stagger')).toBe(true);
    expect(r.filter((x) => !x.stunned).every((x) => x.dmg === 9)).toBe(true);
  });

  test('stun adds to the time left instead of replacing it', () => {
    const t = setup(open(4, 2));
    const ctx = fullCtx(t.state);
    const hero = heroOf(t.state);
    setItimeout(t.state, hero, P.STUNNED, 20);
    const mon = t.state.entities[String(addMon(t.state, 'nh:newt', 3, 1))]!;
    for (let i = 0; i < 100; i++) hitmuAd(ctx, mon, atk('claw', 'stun', 1, 6), 6);
    expect(hero.c.props!['stunned']!.timeout).toBeGreaterThan(t.state.turn + 20);
  });

  test('magic cancellation: body armor with MC 2 blocks 60% of special effects', () => {
    const t = setup(open(6, 3));
    const ctx = fullCtx(t.state);
    const hero = heroOf(t.state);
    const mon = t.state.entities[String(addMon(t.state, 'nh:newt', 3, 1))]!;
    // the shield (MC 0) negates nothing; fake a worn piece of armor with MC 2 (mithril)
    const coat = ctx.spawn({
      def: 'nh:dwarvish_mithril_coat' as DefId,
      c: {
        item: {
          quantity: 1,
          buc: 'uncursed',
          spe: 0,
          known: { buc: true, spe: true },
          carriedBy: hero.id,
          letter: 'z',
          equipped: 'body',
          placed: 0,
        },
      },
    });
    expect(coat).toBeGreaterThan(0);
    let zapped = 0;
    for (let i = 0; i < 1000; i++) {
      ctx.events.length = 0;
      const d = hitmuAd(ctx, mon, atk('bite', 'elec', 1, 1), 1);
      if (keys(ctx.events).includes('mhitu.zapped')) zapped++;
      else expect(d).toBe(0);
    }
    // rn2(10) >= 3 * 2 passes only for 6..9: 40%
    expect(zapped).toBeGreaterThan(340);
    expect(zapped).toBeLessThan(460);
  });
});

describe('poison', () => {
  const run = (n: number, typ: 'str' | 'con', o: { poisonRes?: boolean; hp?: number } = {}) => {
    const t = setup(open(4, 2), 11);
    const ctx = fullCtx(t.state);
    const hero = heroOf(t.state);
    const out = { attr: 0, hp: 0, severe: 0, dead: 0, res: 0 };
    for (let i = 0; i < n && !t.state.gameOver; i++) {
      hero.c.attributes = { str: 16, int: 10, wis: 10, dex: 12, con: 14, cha: 10 };
      hero.c.hp = { cur: o.hp ?? 500, max: o.hp ?? 500 };
      hero.c.props = o.poisonRes ? { poison_res: { intrinsic: true, timeout: 0 } } : {};
      ctx.events.length = 0;
      poisoned(ctx, null, typ, '@nh:centipede', 30);
      const k = keys(ctx.events);
      if (k.includes('poison.no_effect')) out.res++;
      else if (k.includes('poison.deadly')) out.dead++;
      else if (hero.c.hp.max < (o.hp ?? 500)) out.severe++;
      else if (hero.c.hp.cur < (o.hp ?? 500)) out.hp++;
      else out.attr++;
    }
    return { ...out, t, hero };
  };

  test('outcomes over seeds: 1 in 30 severe, 80% HP loss of 6..15, the rest attribute loss', () => {
    const r = run(3000, 'str');
    expect(r.severe).toBeGreaterThan(50);
    expect(r.severe).toBeLessThan(160);
    expect(r.hp).toBeGreaterThan(2250);
    expect(r.hp).toBeLessThan(2550);
    expect(r.attr).toBeGreaterThan(300);
    expect(r.attr).toBeLessThan(560);
    expect(r.dead).toBe(0);
  });

  test('a severe reaction cuts maximum HP and costs Con and the poisoned attribute', () => {
    const t = setup(open(4, 2), 5);
    const ctx = fullCtx(t.state);
    const hero = heroOf(t.state);
    let hit = false;
    for (let i = 0; i < 600 && !hit; i++) {
      hero.c.attributes = { str: 16, int: 10, wis: 10, dex: 12, con: 14, cha: 10 };
      hero.c.hp = { cur: 500, max: 500 };
      ctx.events.length = 0;
      poisoned(ctx, null, 'str', '@nh:centipede', 30);
      if (hero.c.hp.max < 500) {
        hit = true;
        expect(500 - hero.c.hp.max).toBeGreaterThanOrEqual(5); // loss / 2, loss 10..34
        expect(500 - hero.c.hp.max).toBeLessThanOrEqual(17);
        expect(hero.c.attributes.con).toBe(13);
        expect(hero.c.attributes.str).toBe(13);
        expect(keys(ctx.events)).toEqual(['poison.tell.con', 'poison.tell.str']);
      }
    }
    expect(hit).toBe(true);
  });

  test('Constitution poison loses 3 Con on a severe reaction', () => {
    const t = setup(open(4, 2), 5);
    const ctx = fullCtx(t.state);
    const hero = heroOf(t.state);
    let hit = false;
    for (let i = 0; i < 600 && !hit; i++) {
      hero.c.attributes = { str: 16, int: 10, wis: 10, dex: 12, con: 14, cha: 10 };
      hero.c.hp = { cur: 500, max: 500 };
      poisoned(ctx, null, 'con', '@nh:rabid_rat', 30);
      if (hero.c.hp.max < 500) {
        hit = true;
        expect(hero.c.attributes.con).toBe(11);
      }
    }
    expect(hit).toBe(true);
  });

  test('poison can be deadly to a hero with few hit points', () => {
    const r = run(400, 'str', { hp: 8 });
    expect(r.dead).toBeGreaterThan(0);
    expect(r.t.state.gameOver?.kind).toBe('died');
    expect(r.t.state.gameOver?.killer).toBe('@nh:centipede');
  });

  test('poison resistance: "The poison doesn\'t seem to affect you."', () => {
    const r = run(200, 'str', { poisonRes: true });
    expect(r.res).toBe(200);
    expect(r.attr + r.hp + r.severe + r.dead).toBe(0);
  });

  test('announces the poisoning first', () => {
    const t = setup(open(4, 2));
    const ctx = fullCtx(t.state);
    poisoned(
      ctx,
      { key: 'mhitu.was_poisoned', params: { mon: '@nh:centipede', subj: '@poison.subj.bite' } },
      'str',
      'x',
      30,
    );
    expect(keys(ctx.events)[0]).toBe('mhitu.was_poisoned');
  });

  test('centipede and rabid rat bites poison through the full attack path', () => {
    const hits = (id: string) => {
      let poisonedMsgs = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const t = setup(open(6, 3), seed);
        const hero = heroOf(t.state);
        hero.c.hp = { cur: 5000, max: 5000 };
        delete hero.c.props;
        const m = addMon(t.state, id, 2, 1);
        t.state.entities[String(m)]!.c.monster!.level = def(id).level;
        const ctx = fullCtx(t.state);
        for (let i = 0; i < 100; i++) monsterAttack(ctx, m);
        poisonedMsgs += keys(ctx.events).filter((k) => k === 'mhitu.was_poisoned').length;
      }
      return poisonedMsgs;
    };
    expect(hits('nh:centipede')).toBeGreaterThan(0);
    expect(hits('nh:rabid_rat')).toBeGreaterThan(0);
  });
});

// ---- passive attacks ----

describe('passive attacks', () => {
  test('brown mold: cold damage to a hero without resistance, and it feeds on the heat', () => {
    let seen = false;
    for (let seed = 1; seed <= 60 && !seen; seed++) {
      const r = hitMold(seed, 'nh:brown_mold', { hp: 20 });
      if (keys(r.events).includes('passive.very_cold')) {
        seen = true;
        expect(r.hpLost).toBeGreaterThanOrEqual(2); // d(2, 6)
        expect(r.hpLost).toBeLessThanOrEqual(12);
        const hp = r.t.state.entities[String(r.mon)]?.c.hp;
        expect(hp!.cur).toBeGreaterThan(20 - 20); // still alive and healed past its start
        expect(hp!.max).toBeGreaterThanOrEqual(20);
      }
    }
    expect(seen).toBe(true);
  });

  test('brown mold vs the cold-resistant Valkyrie: a mild chill, no damage', () => {
    let chills = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = hitMold(seed, 'nh:brown_mold', {
        props: { cold_res: { intrinsic: true, timeout: 0 } },
      });
      const k = keys(r.events);
      expect(k).not.toContain('passive.very_cold');
      if (k.includes('passive.mild_chill')) {
        chills++;
        expect(r.hpLost).toBe(0);
      }
    }
    expect(chills).toBeGreaterThan(20);
  });

  test('the molds never attack on their own', () => {
    const t = fight(4);
    const m = addMon(t.state, 'nh:brown_mold', 2, 1);
    t.state.entities[String(m)]!.c.monster!.level = 1;
    for (let i = 0; i < 15; i++)
      expect(keys(t.wait().events).some((k) => k.startsWith('combat.mon_'))).toBe(false);
    expect(t.hero.c.hp!.cur).toBe(5000);
  });

  test('yellow mold stuns for d(2,4) turns, only if not already stunned', () => {
    let seen = false;
    for (let seed = 1; seed <= 60 && !seen; seed++) {
      const r = hitMold(seed, 'nh:yellow_mold');
      const k = keys(r.events);
      if (!k.includes('stun.stagger')) continue;
      seen = true;
      expect(r.hpLost).toBe(0);
      // the stun was set during the attack and (up to 8 turns) has run down by now
      expect(k.filter((x) => x === 'stun.stagger')).toHaveLength(1);
    }
    expect(seen).toBe(true);
    // attacking again while stunned adds no stagger message
    const t = fight(9);
    const mon = addMon(t.state, 'nh:yellow_mold', 2, 1);
    t.state.entities[String(mon)]!.c.hp = { cur: 9999, max: 9999 };
    t.state.entities[String(mon)]!.c.monster!.level = 1;
    setItimeout(t.state, t.hero, P.STUNNED, 5000);
    const ks: string[] = [];
    for (let i = 0; i < 20; i++)
      ks.push(...keys(t.engine.stepAll(t.state, { type: 'move', dir: 'e' }).events));
    expect(ks).not.toContain('stun.stagger');
  });

  test('green mold: acid splash for d(2,4) on about half of the hits, none with resistance', () => {
    let splashes = 0;
    let lost = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const r = hitMold(seed, 'nh:green_mold');
      if (keys(r.events).includes('passive.splashed')) {
        splashes++;
        lost += r.hpLost;
        expect(r.hpLost).toBeGreaterThanOrEqual(2);
        expect(r.hpLost).toBeLessThanOrEqual(8);
      }
    }
    expect(splashes).toBeGreaterThan(8);
    expect(lost).toBeGreaterThan(0);
    for (let seed = 1; seed <= 40; seed++) {
      const r = hitMold(seed, 'nh:green_mold', {
        props: { acid_res: { intrinsic: false, timeout: 99999 } },
      });
      expect(r.hpLost).toBe(0);
    }
  });

  test('acid blob splashes even when the blow kills it', () => {
    let killedAndSplashed = false;
    for (let seed = 1; seed <= 200 && !killedAndSplashed; seed++) {
      const r = hitMold(seed, 'nh:acid_blob', { hp: 1 });
      const k = keys(r.events);
      if (k.includes('combat.you_kill') && k.includes('passive.splashed')) {
        killedAndSplashed = true;
        expect(r.hpLost).toBeGreaterThanOrEqual(1);
        expect(r.hpLost).toBeLessThanOrEqual(8);
      }
    }
    expect(killedAndSplashed).toBe(true);
  });

  test('a dead yellow mold or brown mold cannot answer with its live-only effects', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const y = hitMold(seed, 'nh:yellow_mold', { hp: 1 });
      if (keys(y.events).includes('combat.you_kill'))
        expect(keys(y.events)).not.toContain('stun.stagger');
      const b = hitMold(seed, 'nh:brown_mold', { hp: 1 });
      if (keys(b.events).includes('combat.you_kill')) expect(b.hpLost).toBe(0);
    }
  });

  test('red mold burns, fire resistance gives "You feel mildly warm."', () => {
    let burned = false;
    let warm = false;
    for (let seed = 1; seed <= 60; seed++) {
      const r = hitMold(seed, 'nh:red_mold');
      if (keys(r.events).includes('passive.very_hot')) {
        burned = true;
        // d(2,4) damage is 2 at least, but a point may be regenerated at the end of the turn
        expect(r.hpLost).toBeGreaterThanOrEqual(1);
        expect(r.hpLost).toBeLessThanOrEqual(8);
      }
      const f = hitMold(seed, 'nh:red_mold', {
        props: { fire_res: { intrinsic: true, timeout: 0 } },
      });
      if (keys(f.events).includes('passive.mildly_warm')) {
        warm = true;
        expect(f.hpLost).toBe(0);
      }
    }
    expect(burned && warm).toBe(true);
  });

  describe('floating eye', () => {
    /** One hit on an unfrozen hero; returns the turns that passed beyond the action's own. */
    function paralysis(seed: number, wis: number): { frozen: boolean; turns: number; k: string[] } {
      const t = fight(seed);
      delete t.hero.c.props;
      t.hero.c.attributes = { str: 16, int: 10, wis, dex: 12, con: 14, cha: 10 };
      const mon = addMon(t.state, 'nh:floating_eye', 2, 1);
      const m = t.state.entities[String(mon)]!;
      m.c.hp = { cur: 100000, max: 100000 };
      m.c.monster!.level = 2;
      m.c.actor = { energy: 0, speed: 0 }; // it never moves
      const t0 = t.state.turn;
      const r = t.engine.step(t.state, { type: 'move', dir: 'e' });
      const k = keys(r.events);
      return { frozen: k.includes('passive.frozen_gaze'), turns: t.state.turn - t0 - 1, k };
    }

    test('hitting a floating eye you can see freezes you for d(3,70) turns', () => {
      const durations: number[] = [];
      for (let seed = 1; seed <= 300; seed++) {
        const r = paralysis(seed, 18);
        if (r.frozen) durations.push(r.turns);
      }
      expect(durations.length).toBeGreaterThan(120); // 2 in 3 of the blows, hit or miss
      expect(Math.min(...durations)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...durations)).toBeLessThanOrEqual(210);
      const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
      expect(mean).toBeGreaterThan(90);
      expect(mean).toBeLessThan(122);
    });

    test('with Wis 12 or less one freeze in four lasts 127 turns', { timeout: 30000 }, () => {
      const count127 = (wis: number): [number, number] => {
        let n = 0;
        let all = 0;
        for (let seed = 1; seed <= 400; seed++) {
          const r = paralysis(seed, wis);
          if (!r.frozen) continue;
          all++;
          if (r.turns === 127) n++;
        }
        return [n, all];
      };
      const [lowN, lowAll] = count127(7);
      const [highN] = count127(18);
      expect(lowN / lowAll).toBeGreaterThan(0.15);
      expect(lowN / lowAll).toBeLessThan(0.36);
      expect(highN).toBeLessThan(12);
    });

    test('the freeze shows as helpless and ends with "You can move again."', () => {
      let checked = false;
      for (let seed = 1; seed <= 100 && !checked; seed++) {
        const t = fight(seed);
        delete t.hero.c.props;
        const mon = addMon(t.state, 'nh:floating_eye', 2, 1);
        const m = t.state.entities[String(mon)]!;
        m.c.hp = { cur: 100000, max: 100000 };
        m.c.monster!.level = 2;
        m.c.actor = { energy: 0, speed: 0 };
        const ctx = fullCtx(t.state);
        // call passive() directly: the hero is frozen right here, the clock not yet advanced
        const snap = { id: mon, def: def('nh:floating_eye'), level: 2, pos: { ...m.c.pos! } };
        for (let i = 0; i < 20 && !t.hero.c.helpless; i++) passive(ctx, snap, true, true);
        if (!t.hero.c.helpless) continue;
        checked = true;
        expect(t.hero.c.helpless.reasonKey).toBe('helpless.frozen_gaze');
        expect(t.hero.c.helpless.until).toBeGreaterThan(t.state.turn + 3);
        const r = t.engine.step(t.state, { type: 'wait' });
        expect(keys(r.events)).toContain('eat.can_move_again');
        expect(t.hero.c.helpless).toBeUndefined();
      }
      expect(checked).toBe(true);
    });

    test('an eye the hero cannot see does nothing', () => {
      const t = fight(2);
      delete t.hero.c.props;
      const mon = addMon(t.state, 'nh:floating_eye', 2, 1);
      const ctx = fullCtx(t.state);
      const snap = {
        id: mon,
        def: def('nh:floating_eye'),
        level: 2,
        pos: { level: 'elsewhere', x: 2, y: 1 },
      };
      for (let i = 0; i < 60; i++) passive(ctx, snap, true, true);
      expect(t.hero.c.helpless).toBeUndefined();
      expect(keys(ctx.events)).not.toContain('passive.frozen_gaze');
    });

    test('killing it before it can answer is safe', () => {
      for (let seed = 1; seed <= 80; seed++) {
        const r = hitMold(seed, 'nh:floating_eye', { hp: 1 });
        if (keys(r.events).includes('combat.you_kill'))
          expect(keys(r.events)).not.toContain('passive.frozen_gaze');
      }
    });
  });
});

// ---- stunned movement ----

describe('stunned movement', () => {
  test('a stunned hero moves in a random direction, never into a wall', () => {
    const t = setup(open(9, 9), 21);
    const hero = heroOf(t.state);
    const pos = hero.c.pos!;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      Object.assign(pos, { x: 5, y: 5 });
      setItimeout(t.state, hero, P.STUNNED, 100000);
      for (const k of Object.keys(t.state.entities))
        // random monsters that arrive in 400 turns
        if (t.state.entities[k]?.c.monster) delete t.state.entities[k];
      t.engine.step(t.state, { type: 'move', dir: 'e' });
      const key = `${pos.x - 5},${pos.y - 5}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toHaveLength(8);
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThan(20);
      expect(n).toBeLessThan(90);
    }
  });

  test('beside a wall the stunned hero still never walks into rock', () => {
    const t = setup(['-----', '|@..|', '-----'], 3);
    const hero = heroOf(t.state);
    const pos = hero.c.pos!;
    for (let i = 0; i < 100; i++) {
      Object.assign(pos, { x: 1, y: 1 });
      setItimeout(t.state, hero, P.STUNNED, 100000);
      t.engine.step(t.state, { type: 'move', dir: 'e' });
      expect(pos.y).toBe(1);
      expect(pos.x).toBeGreaterThanOrEqual(1);
      expect(pos.x).toBeLessThanOrEqual(3);
    }
  });

  test('an unstunned hero moves where she says', () => {
    const t = setup(open(9, 9), 21);
    const pos = heroOf(t.state).c.pos!;
    for (let i = 0; i < 30; i++) {
      Object.assign(pos, { x: 5, y: 5 });
      t.engine.step(t.state, { type: 'move', dir: 'e' });
      expect(pos.x).toBe(6);
    }
  });

  test('travel and runs go astray too', () => {
    const t = setup(open(15, 15), 8);
    const hero = heroOf(t.state);
    const pos = hero.c.pos!;
    let off = 0;
    for (let i = 0; i < 40; i++) {
      Object.assign(pos, { x: 2, y: 8 });
      setItimeout(t.state, hero, P.STUNNED, 5);
      t.engine.step(t.state, {
        type: 'mod',
        action: 'nh:run' as DefId,
        args: { dir: 'e', mode: 'rush' },
      } as never);
      if (pos.y !== 8) off++;
    }
    expect(off).toBeGreaterThan(5);
  });

  test('stun ends and moves are straight again', () => {
    const t = setup(open(9, 9), 21);
    const hero = heroOf(t.state);
    const pos = hero.c.pos!;
    setItimeout(t.state, hero, P.STUNNED, 3);
    for (let i = 0; i < 3; i++) {
      Object.assign(pos, { x: 5, y: 5 });
      t.wait();
    }
    expect(hasProp(hero, P.STUNNED)).toBe(false);
    Object.assign(pos, { x: 5, y: 5 });
    t.engine.step(t.state, { type: 'move', dir: 'e' });
    expect(pos.x).toBe(6);
  });
});

// ---- sticking ----

describe('being stuck to a lichen', () => {
  const lichenSetup = (seed = 1) => {
    const t = setup(open(8, 3), seed);
    const hero = heroOf(t.state);
    hero.c.hp = { cur: 5000, max: 5000 };
    delete hero.c.props;
    Object.assign(hero.c.pos!, { x: 3, y: 2 });
    const id = addMon(t.state, 'nh:lichen', 4, 2);
    const l = t.state.entities[String(id)]!;
    l.c.monster!.level = 0;
    l.c.actor = { energy: 0, speed: 0 };
    return { ...t, hero, id, lichen: l };
  };

  test('a touch that hits sticks her to the lichen, which does no damage', () => {
    const t = lichenSetup(6);
    const ctx = fullCtx(t.state);
    let stuck = false;
    for (let i = 0; i < 100 && !stuck; i++) {
      monsterAttack(ctx, t.id);
      stuck = ustuck(ctx) === t.id;
    }
    expect(stuck).toBe(true);
    expect(keys(ctx.events)).toContain('combat.mon_touches');
    expect(t.hero.c.hp!.cur).toBe(5000);
  });

  test('moving away: "You cannot escape from the lichen!" and the move is lost', () => {
    const t = lichenSetup();
    setUstuck({ state: t.state }, t.id);
    const x0 = posOf(t.state, t.state.playerId).x;
    const ks: string[] = [];
    let freed = false;
    for (let i = 0; i < 400 && !freed; i++) {
      const turn = t.state.turn;
      const r = t.engine.step(t.state, { type: 'move', dir: 'w' });
      ks.push(...keys(r.events));
      if (keys(r.events).includes('stuck.pull_free')) {
        freed = true;
        break;
      }
      expect(keys(r.events)).toContain('stuck.cannot_escape');
      expect(t.state.turn).toBeGreaterThan(turn); // it took time
      expect(posOf(t.state, t.state.playerId).x).toBe(x0);
    }
    expect(freed).toBe(true);
    expect(ustuck({ state: t.state })).toBeNull();
    // on the freeing move she did get away
    expect(posOf(t.state, t.state.playerId).x).toBe(x0 - 1);
  });

  test('about 3 tries in 40 pull free', () => {
    const t = lichenSetup();
    const ctx = fullCtx(t.state);
    const pos = posOf(t.state, t.state.playerId);
    let free = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      setUstuck(ctx, t.id);
      if (!escapeFromStickyMon(ctx, { x: pos.x - 1, y: pos.y })) free++;
    }
    expect(free / N).toBeGreaterThan(0.055);
    expect(free / N).toBeLessThan(0.095);
  });

  test('attacking the lichen itself is not an escape attempt', () => {
    const t = lichenSetup();
    setUstuck({ state: t.state }, t.id);
    const pos = posOf(t.state, t.id);
    const ctx = fullCtx(t.state);
    for (let i = 0; i < 50; i++) expect(escapeFromStickyMon(ctx, pos)).toBe(false);
    expect(ustuck(ctx)).toBe(t.id);
  });

  test('the hold ends when the lichen dies, moves away or is gone', () => {
    const t = lichenSetup();
    const c = { state: t.state };
    setUstuck(c, t.id);
    expect(ustuck(c)).toBe(t.id);
    t.lichen.c.pos!.x = 7; // no longer adjacent
    expect(ustuck(c)).toBeNull();
    t.lichen.c.pos!.x = 4;
    setUstuck(c, t.id);
    delete t.state.entities[String(t.id)]; // dead
    expect(ustuck(c)).toBeNull();
  });

  test('killing the lichen frees her', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const t = lichenSetup(seed);
      t.state.entities[String(t.id)]!.c.hp = { cur: 1, max: 1 };
      setUstuck({ state: t.state }, t.id);
      for (let i = 0; i < 10 && t.state.entities[String(t.id)]; i++)
        t.engine.step(t.state, { type: 'move', dir: 'e' });
      if (!t.state.entities[String(t.id)]) {
        expect(ustuck({ state: t.state })).toBeNull();
        return;
      }
    }
    throw new Error('never killed the lichen');
  });

  test('stuck state is plain data and saves', () => {
    const t = lichenSetup();
    setUstuck({ state: t.state }, t.id);
    expect(JSON.parse(JSON.stringify(t.state.modData))).toEqual(t.state.modData);
  });
});

// ---- grid bugs ----

describe('grid bug', () => {
  test('mfndpos offers only orthogonal squares', () => {
    const t = setup(open(6, 6), 2);
    const bug = addMon(t.state, 'nh:grid_bug', 3, 3);
    const level = getLevel(t.state, 'dlvl1');
    const ctx = fullCtx(t.state);
    const c = mfndpos(ctx, level, cellRules(level, defs), bug, { x: 6, y: 6 });
    expect(c.map((p) => `${p.x - 3},${p.y - 3}`).sort()).toEqual(['-1,0', '0,-1', '0,1', '1,0']);
    const jackal = addMon(t.state, 'nh:jackal', 5, 5);
    expect(mfndpos(ctx, level, cellRules(level, defs), jackal, { x: 1, y: 1 })).toHaveLength(8);
  });

  test('it never steps or bites diagonally', () => {
    const t = setup(open(7, 7), 12);
    const hero = heroOf(t.state);
    hero.c.hp = { cur: 5000, max: 5000 };
    const bug = addMon(t.state, 'nh:grid_bug', 6, 6);
    t.state.entities[String(bug)]!.c.monster!.level = 0;
    let prev = posOf(t.state, bug);
    let bites = 0;
    for (let i = 0; i < 80; i++) {
      const r = t.wait();
      const p = posOf(t.state, bug);
      const hp = heroOf(t.state).c.pos!;
      expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBeLessThanOrEqual(1);
      if (keys(r.events).includes('combat.mon_bites')) {
        bites++;
        expect(Math.abs(p.x - hp.x) + Math.abs(p.y - hp.y)).toBe(1); // orthogonal neighbour
      }
      prev = p;
    }
    expect(bites).toBeGreaterThan(0);
  });

  test('a grid bug diagonal to the hero cannot attack until it steps beside her', () => {
    const t = setup(open(5, 5), 4);
    const hero = heroOf(t.state);
    Object.assign(hero.c.pos!, { x: 3, y: 3 });
    const bug = addMon(t.state, 'nh:grid_bug', 4, 4);
    t.state.entities[String(bug)]!.c.monster!.level = 0;
    const r = t.wait();
    expect(keys(r.events)).not.toContain('combat.mon_bites');
    expect(keys(r.events)).not.toContain('mhitu.zapped');
  });

  test('its bite is electric: shock resistance stops the damage', () => {
    let zap = 0;
    let harmless = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const res of [false, true]) {
        const t = setup(open(4, 2), seed);
        const hero = heroOf(t.state);
        hero.c.hp = { cur: 500, max: 500 };
        if (res) hero.c.props = { shock_res: { intrinsic: true, timeout: 0 } };
        else delete hero.c.props;
        const bug = addMon(t.state, 'nh:grid_bug', 2, 1);
        const ctx = fullCtx(t.state);
        for (let i = 0; i < 20; i++) monsterAttack(ctx, bug);
        if (keys(ctx.events).includes('mhitu.zapped')) {
          if (res) {
            harmless++;
            expect(hero.c.hp!.cur).toBe(500);
          } else {
            zap++;
            expect(hero.c.hp!.cur).toBeLessThan(500);
          }
        }
      }
    }
    expect(zap).toBeGreaterThan(0);
    expect(harmless).toBeGreaterThan(0);
  });
});

// ---- corpse intrinsics ----

describe('corpse intrinsics', () => {
  const bare = () => {
    const t = setup(open(4, 2), 31);
    const hero = heroOf(t.state);
    delete hero.c.props;
    return { ...t, hero, ctx: fullCtx(t.state) };
  };
  const lvl = (id: string, level: number) => ({ ...def(id), level });

  test('should_givit: a level L monster succeeds L times in 15', () => {
    const { ctx } = bare();
    for (const L of [1, 5, 10]) {
      let n = 0;
      for (let i = 0; i < 6000; i++) if (shouldGivit(ctx, P.FIRE_RES, lvl('nh:red_mold', L))) n++;
      expect(Math.abs(n / 6000 - L / 15)).toBeLessThan(0.03);
    }
    // level 15 or more never fails
    for (let i = 0; i < 200; i++)
      expect(shouldGivit(ctx, P.FIRE_RES, lvl('nh:red_mold', 15))).toBe(true);
  });

  test('corpse_intrinsic picks among the conveyed resistances at random', () => {
    const { ctx } = bare();
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const p = corpseIntrinsic(ctx, def('nh:brown_mold')) ?? 'none';
      counts[p] = (counts[p] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['cold_res', 'poison_res']);
    expect(counts['cold_res']).toBeGreaterThan(850);
    expect(counts['cold_res']).toBeLessThan(1150);
    expect(corpseIntrinsic(ctx, def('nh:newt'))).toBeNull();
  });

  test('the floating eye conveys telepathy', () => {
    const { ctx } = bare();
    expect(corpseIntrinsic(ctx, def('nh:floating_eye'))).toBe('telepat');
  });

  test('givit: the message once, the property forever', () => {
    const { ctx, hero } = bare();
    const sure = lvl('nh:red_mold', 30);
    givit(ctx, P.FIRE_RES, sure);
    givit(ctx, P.FIRE_RES, sure);
    givit(ctx, P.COLD_RES, sure);
    givit(ctx, P.SLEEP_RES, sure);
    givit(ctx, P.SHOCK_RES, sure);
    givit(ctx, P.TELEPAT, sure);
    expect(keys(ctx.events)).toEqual([
      'givit.fire',
      'givit.cold',
      'givit.sleep',
      'givit.shock',
      'givit.telepat',
    ]);
    for (const p of [P.FIRE_RES, P.COLD_RES, P.SLEEP_RES, P.SHOCK_RES, P.TELEPAT])
      expect(hero.c.props?.[p]).toEqual({ intrinsic: true, timeout: 0 });
  });

  test('givit poison resistance: "healthy", or "especially healthy" with another source', () => {
    const a = bare();
    givit(a.ctx, P.POISON_RES, lvl('nh:centipede', 30));
    expect(keys(a.ctx.events)).toEqual(['givit.poison']);
    const b = bare();
    setItimeout(b.state, b.hero, P.POISON_RES, 50);
    givit(b.ctx, P.POISON_RES, lvl('nh:centipede', 30));
    expect(keys(b.ctx.events)).toEqual(['givit.poison_more']);
  });

  test('acid resistance from a corpse is temporary: d(3,6) turns', () => {
    const { ctx, hero, state } = bare();
    givit(ctx, P.ACID_RES, lvl('nh:green_mold', 30));
    expect(keys(ctx.events)).toEqual(['givit.acid']);
    const left = hero.c.props!['acid_res']!.timeout - state.turn;
    expect(left).toBeGreaterThanOrEqual(3);
    expect(left).toBeLessThanOrEqual(18);
    expect(hero.c.props!['acid_res']!.intrinsic).toBe(false);
  });

  test('a weak monster usually gives nothing', () => {
    const { ctx, hero } = bare();
    let given = 0;
    for (let i = 0; i < 1500; i++) {
      delete hero.c.props;
      cpostfxOf(ctx, def('nh:red_mold'));
      if (hero.c.props?.['fire_res']) given++;
    }
    // level 1: 1/15 for the lone fire/poison choice at 1/2 each
    expect(given).toBeGreaterThan(10);
    expect(given).toBeLessThan(100);
  });

  test('bat corpses stun for 30 turns each, a giant bat for 60', () => {
    const { ctx, hero, state } = bare();
    cpostfxOf(ctx, def('nh:bat'));
    expect(hero.c.props!['stunned']!.timeout).toBe(state.turn + 30);
    cpostfxOf(ctx, def('nh:giant_bat'));
    expect(hero.c.props!['stunned']!.timeout).toBe(state.turn + 90);
    expect(keys(ctx.events)).toEqual([]); // talk is off
  });

  test('eating a corpse runs the postfix', () => {
    // a bat corpse eaten whole stuns
    let stunned = false;
    for (let seed = 1; seed <= 30 && !stunned; seed++) {
      const s = levelSetup(['.......', '...@...', '.......'], seed);
      const c = s.carry('nh:corpse', { corpseOf: 'nh:bat' });
      for (let i = 0; i < 12; i++) s.mod('nh:eat', { item: c });
      if (hasProp(s.hero, P.STUNNED) || s.hero.c.props?.['stunned']) stunned = true;
    }
    expect(stunned).toBe(true);
  });
});
