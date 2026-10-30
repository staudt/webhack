import {
  getPlayer,
  inventoryOf,
  itemsAt,
  type Ctx,
  type DefId,
  type EntityId,
  type GameEvent,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import { P_EXPERT, makemon, mongets, nhData, selectRwep, thrwmu } from '../src/index';
import { addMon, setup } from './helpers';
import { ctxFor, defs, engine, levelSetup, plainKit, render } from './itemHelpers';

// a lit room: the hero at the left end of a long row
const ROOM = [
  '-'.repeat(22),
  `|@${'.'.repeat(19)}|`,
  `|${'.'.repeat(20)}|`,
  `|${'.'.repeat(20)}|`,
  '-'.repeat(22),
];
const mdef = (id: string) => defs.monster(id as DefId);
const clear = () => true;
/** A Ctx for calling the monster functions directly (events are collected in `events`). */
const mctx = (state: Parameters<typeof ctxFor>[0]): Ctx => {
  const c = ctxFor(state);
  return Object.assign(c, {
    interrupt: () => {},
    endGame: () => {
      state.gameOver = { kind: 'died', killer: 'test', turn: 0, depth: 1, level: 1 };
    },
  }) as unknown as Ctx;
};
const evs = (c: Ctx): GameEvent[] => (c as unknown as { events: GameEvent[] }).events;
const keys = (ev: GameEvent[]): string[] => ev.flatMap((e) => (e.type === 'msg' ? [e.key] : []));
const text = (ev: GameEvent[]): string[] =>
  ev.flatMap((e) =>
    e.type === 'msg' ? [render({ key: e.key, ...(e.params ? { params: e.params } : {}) })] : [],
  );
type Proj = Extract<GameEvent, { type: 'projectile' }>;
const projs = (ev: GameEvent[]): Proj[] => ev.filter((e): e is Proj => e.type === 'projectile');

/** A hostile monster of `def` at (x, y) holding the given gear (and nothing else). */
function armed(
  t: ReturnType<typeof setup>,
  ctx: Ctx,
  def: string,
  x: number,
  y: number,
  gear: [string, number?][],
) {
  const id = addMon(t.state, def, x, y);
  const mon = t.state.entities[String(id)]!;
  mon.c.monster!.level = 1;
  for (const [g, quantity] of gear) {
    const item = mongets(ctx, id, g)!;
    const it = t.state.entities[String(item)]!.c.item!;
    it.buc = 'uncursed';
    it.spe = 0;
    if (quantity !== undefined) it.quantity = quantity;
  }
  return id;
}
const heroHp = (t: ReturnType<typeof setup>) => getPlayer(t.state).c.hp!.cur;
const floorDefs = (t: ReturnType<typeof setup>, x: number, y: number) =>
  itemsAt(defs, t.state, 'dlvl1', x, y).map((e) => e.def);

describe('monster starting gear includes launchers, ammo and darts', () => {
  function counts(id: string, n: number) {
    const t = setup(ROOM, 5);
    const ctx = mctx(t.state);
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const mid = makemon(ctx, mdef(id), { x: 15, y: 2 }, { nogroup: true })!;
      for (const d of new Set(inventoryOf(t.state, mid).map((e) => e.def)))
        seen.set(d, (seen.get(d) ?? 0) + 1);
      for (const e of inventoryOf(t.state, mid)) delete t.state.entities[String(e.id)];
      delete t.state.entities[String(mid)];
    }
    return (d: string) => (seen.get(d) ?? 0) / n;
  }
  const near = (a: number, b: number, tol = 0.035) => expect(Math.abs(a - b)).toBeLessThan(tol);

  test('kobolds: a stack of darts 1 time in 4', () => {
    near(counts('nh:kobold', 2500)('nh:dart'), 1 / 4, 0.04);
  });
  test('gnomes: darts, crossbow with bolts, or bow with arrows, 1 in 14 each', () => {
    const f = counts('nh:gnome', 4000);
    near(f('nh:dart'), 1 / 14);
    near(f('nh:crossbow'), 1 / 14);
    near(f('nh:crossbow_bolt'), 1 / 14);
    near(f('nh:bow'), 1 / 14);
    near(f('nh:arrow'), 1 / 14);
  });
  test('hobbits: a sling with rocks or flint 1 time in 3', () => {
    const f = counts('nh:hobbit', 3000);
    near(f('nh:sling'), 1 / 3, 0.04);
    near(f('nh:rock'), ((1 / 3) * 3) / 4, 0.04);
    near(f('nh:flint_stone'), 1 / 3 / 4, 0.03);
  });
  test('hill orcs get no bows in 5.0 (only Uruk-hai do)', () => {
    const f = counts('nh:hill_orc', 600);
    expect(f('nh:orcish_bow')).toBe(0);
    expect(f('nh:orcish_arrow')).toBe(0);
  });
  test('stacks are 3 to 14 missiles', () => {
    const t = setup(ROOM, 5);
    const ctx = mctx(t.state);
    let seen = 0;
    for (let i = 0; i < 400 && seen < 20; i++) {
      const mid = makemon(ctx, mdef('nh:kobold'), { x: 15, y: 2 }, { nogroup: true })!;
      for (const e of inventoryOf(t.state, mid)) {
        if (e.def === 'nh:dart') {
          seen++;
          expect(e.c.item!.quantity).toBeGreaterThanOrEqual(3);
          expect(e.c.item!.quantity).toBeLessThanOrEqual(14);
        }
        delete t.state.entities[String(e.id)];
      }
      delete t.state.entities[String(mid)];
    }
    expect(seen).toBeGreaterThan(5);
  });
});

describe('select_rwep', () => {
  test('arrows need a bow; a sling shoots stones before darts; daggers need nothing', () => {
    const t = setup(ROOM);
    const ctx = mctx(t.state);
    const a = armed(t, ctx, 'nh:hill_orc', 6, 1, [['nh:arrow', 5]]);
    expect(selectRwep(ctx, a).obj).toBeNull(); // arrows without a bow
    mongets(ctx, a, 'nh:orcish_bow');
    const sel = selectRwep(ctx, a);
    expect(sel.obj?.def).toBe('nh:arrow');
    expect(sel.propellor?.def).toBe('nh:orcish_bow');
    const b = armed(t, ctx, 'nh:hobbit', 6, 2, [['nh:dart', 4], ['nh:sling'], ['nh:rock', 4]]);
    expect(selectRwep(ctx, b).obj?.def).toBe('nh:rock');
    expect(selectRwep(ctx, b).propellor?.def).toBe('nh:sling');
    const c = armed(t, ctx, 'nh:hobbit', 6, 3, [['nh:dart', 4], ['nh:dagger']]);
    expect(selectRwep(ctx, c).obj?.def).toBe('nh:dagger'); // daggers outrank darts
    expect(selectRwep(ctx, c).propellor).toBeNull();
  });
});

describe('thrwmu: a kobold with darts', () => {
  test('throws when lined up and does nothing otherwise', () => {
    const t = setup(ROOM, 3);
    const ctx = mctx(t.state);
    const k = armed(t, ctx, 'nh:kobold', 6, 1, [['nh:dart', 8]]);
    const before = inventoryOf(t.state, k)[0]!.c.item!.quantity;
    thrwmu(ctx, k, clear, null);
    expect(keys(evs(ctx))).toContain('mthrow.throws');
    expect(inventoryOf(t.state, k)[0]!.c.item!.quantity).toBe(before - 1);

    const t2 = setup(ROOM, 3);
    const ctx2 = mctx(t2.state);
    const k2 = armed(t2, ctx2, 'nh:kobold', 5, 3, [['nh:dart', 8]]); // dx 4, dy 2
    thrwmu(ctx2, k2, clear, null);
    expect(evs(ctx2)).toEqual([]);
    expect(inventoryOf(t2.state, k2)[0]!.c.item!.quantity).toBe(8);
    // diagonal works too
    const d = armed(t2, ctx2, 'nh:kobold', 3, 3, [['nh:dart', 8]]); // dx 2, dy 2
    thrwmu(ctx2, d, clear, null);
    expect(keys(evs(ctx2))).toContain('mthrow.throws');
  });

  test('too far away (BOLT_LIM) or no clear line: no throw', () => {
    const t = setup(['-'.repeat(22), `|@${'.'.repeat(19)}|`, '-'.repeat(22)]);
    const ctx = mctx(t.state);
    const far = armed(t, ctx, 'nh:kobold', 12, 1, [['nh:dart', 8]]);
    thrwmu(ctx, far, clear, null);
    expect(evs(ctx)).toEqual([]);
    const near = armed(t, ctx, 'nh:kobold', 5, 1, [['nh:dart', 8]]);
    thrwmu(ctx, near, () => false, null);
    expect(evs(ctx)).toEqual([]);
  });

  test('integration: dochug moves, then throws when it is still not next to her', () => {
    const t = setup(ROOM, 11);
    const ctx = mctx(t.state);
    armed(t, ctx, 'nh:kobold', 8, 1, [['nh:dart', 9]]);
    const ev: GameEvent[] = [];
    for (let i = 0; i < 3; i++) ev.push(...t.wait().events);
    expect(keys(ev)).toContain('mthrow.throws');
    expect(projs(ev).length).toBeGreaterThan(0);
    expect(projs(ev)[0]?.g).toBe('nh:dart');
  });
});

describe('thrwmu: wielding the launcher first', () => {
  test('a hill orc wields its bow (using its move), then fires arrows', () => {
    const t = setup(ROOM, 4);
    const ctx = mctx(t.state);
    const o = armed(t, ctx, 'nh:hill_orc', 7, 1, [['nh:orcish_bow'], ['nh:orcish_arrow', 6]]);
    const events = evs(ctx);
    expect(thrwmu(ctx, o, clear, null)).toBe(true); // wielded: that was its move
    expect(text(events)).toEqual(['The hill orc wields a crude bow!']);
    expect(inventoryOf(t.state, o).find((e) => e.def === 'nh:orcish_bow')?.c.item?.equipped).toBe(
      'weapon',
    );
    events.length = 0;
    expect(thrwmu(ctx, o, clear, null)).toBe(false);
    expect(keys(events)[0]).toMatch(/^mthrow\.shoots/);
    expect(text(events)[0]).toMatch(/^The hill orc shoots (a crude arrow|\d+ crude arrows)!$/);
  });

  test('a volley by a gnome lord numbers its missiles', () => {
    let volleys = 0;
    for (let seed = 1; seed <= 60 && volleys === 0; seed++) {
      const t = setup(ROOM, seed);
      const ctx = mctx(t.state);
      const g = armed(t, ctx, 'nh:gnome_lord', 6, 1, [['nh:bow'], ['nh:arrow', 12]]);
      thrwmu(ctx, g, clear, null); // wields the bow
      evs(ctx).length = 0;
      thrwmu(ctx, g, clear, null);
      const ev = evs(ctx);
      if (keys(ev).includes('mthrow.shoots_n')) {
        volleys++;
        expect(text(ev)[0]).toBe('The gnome lord shoots 2 arrows!');
        // the second missile is named
        expect(text(ev).some((m) => /the 2nd arrow/.test(m))).toBe(true);
        expect(projs(ev)).toHaveLength(2);
      }
    }
    expect(volleys).toBeGreaterThan(0);
  });
});

describe('missiles hit and miss the hero', () => {
  test('messages, damage and where the dart ends up', () => {
    let hits = 0;
    let near = 0;
    let caught = 0;
    let misses = 0;
    let broke = 0;
    let landedAfterHit = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const t = setup(ROOM, seed);
      const ctx = mctx(t.state);
      const k = armed(t, ctx, 'nh:kobold', 4, 1, [['nh:dart', 5]]);
      const hp0 = heroHp(t);
      thrwmu(ctx, k, clear, null);
      const ev = evs(ctx);
      const msgs = text(ev);
      expect(msgs[0]).toBe('The kobold throws a dart!');
      const lost = hp0 - heroHp(t);
      if (msgs.some((m) => /^You are hit by a dart[.!]$/.test(m))) {
        hits++;
        expect(lost).toBeGreaterThanOrEqual(1); // d3 against a medium hero
        expect(lost).toBeLessThanOrEqual(3);
        if (floorDefs(t, 1, 1).includes('nh:dart')) landedAfterHit++;
        else broke++;
      } else if (msgs.includes('You catch the dart!')) {
        caught++;
        expect(lost).toBe(0);
      } else {
        expect(lost).toBe(0);
        if (msgs.includes('You are almost hit by a dart.')) near++;
        else {
          expect(msgs).toContain('The dart misses you.');
          misses++;
        }
        // a miss runs out of range on the hero's square and lands there, never breaks
        expect(floorDefs(t, 1, 1)).toContain('nh:dart');
      }
    }
    expect(hits).toBeGreaterThan(80);
    expect(near + misses).toBeGreaterThan(40);
    expect(near).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
    expect(caught).toBeLessThan(10);
    // darts that hit break 2 times in 3 (chance 3 - spe)
    expect(broke / (broke + landedAfterHit)).toBeGreaterThan(0.5);
    expect(broke / (broke + landedAfterHit)).toBeLessThan(0.8);
  });

  test('to-hit: 8 + spe + 3 - distance against the hero armor class', () => {
    // AC a, distance 3: hit when a + 8 > rnd(20)
    const rate = (spe: number) => {
      let hit = 0;
      const N = 500;
      for (let seed = 1; seed <= N; seed++) {
        const t = setup(ROOM, seed);
        const ctx = mctx(t.state);
        const hero = getPlayer(t.state);
        for (const e of inventoryOf(t.state, hero.id))
          if (e.c.item?.equipped) e.c.item.equipped = null;
        const k = armed(t, ctx, 'nh:kobold', 4, 1, [['nh:dart', 5]]);
        inventoryOf(t.state, k)[0]!.c.item!.spe = spe;
        const hp0 = heroHp(t);
        thrwmu(ctx, k, clear, null);
        if (heroHp(t) < hp0) hit++;
      }
      return hit / N;
    };
    // no armor: AC 10 => 18 > d20 for +0 (85%); a +4 dart always hits except a natural 20 is
    // still a miss only when ac + tlev <= 20: 10 + 12 = 22 > 20 hits always
    expect(Math.abs(rate(0) - 0.85)).toBeLessThan(0.05);
    expect(rate(4)).toBeGreaterThan(0.99);
  });

  test('projectile events list only the cells the hero sees', () => {
    const t = setup(ROOM, 8);
    const ctx = mctx(t.state);
    const k = armed(t, ctx, 'nh:kobold', 5, 1, [['nh:dart', 5]]);
    const w = t.state.levels['dlvl1']!.width;
    t.state.visible = t.state.visible.filter((i) => i !== 1 * w + 3); // (3,1) is out of sight
    thrwmu(ctx, k, clear, null);
    const p = projs(evs(ctx));
    expect(p).toHaveLength(1);
    expect(p[0]?.g).toBe('nh:dart');
    expect(p[0]?.path.map((c) => c.x)).toEqual([4, 2, 1]);
    // the animation comes before the hit or miss message
    const ev = evs(ctx);
    const i = ev.findIndex((e) => e.type === 'projectile');
    const m = ev.findIndex(
      (e) => e.type === 'msg' && e.key.startsWith('mthrow.') && !e.key.includes('throws'),
    );
    expect(i).toBeLessThan(m);
  });

  test('a cursed dart may slip in a random direction; no missile is ever lost track of', () => {
    let slipped = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const t = setup(ROOM, seed);
      const ctx = mctx(t.state);
      const k = armed(t, ctx, 'nh:kobold', 5, 1, [['nh:dart', 1]]);
      inventoryOf(t.state, k)[0]!.c.item!.buc = 'cursed';
      thrwmu(ctx, k, clear, null);
      if (text(evs(ctx)).includes('The dart slips as the kobold throws it!')) slipped++;
      // the dart is on the floor somewhere in the room, or it broke after hitting her
      const onFloor = Object.values(t.state.entities).filter(
        (e) => e.def === 'nh:dart' && e.c.pos,
      ).length;
      const hit = text(evs(ctx)).some((m) => m.startsWith('You are hit'));
      const caught = text(evs(ctx)).includes('You catch the dart!'); // 1 in (100 - Dex)
      expect(onFloor + (hit || caught ? 1 : 0)).toBeGreaterThanOrEqual(1);
      expect(inventoryOf(t.state, k).length).toBe(0);
    }
    expect(slipped).toBeGreaterThan(10);
    expect(slipped).toBeLessThan(60);
  });

  test("another monster in the way is hit instead (and its death is not the hero's)", () => {
    let killed = false;
    for (let seed = 1; seed <= 200 && !killed; seed++) {
      const t = setup(ROOM, seed);
      const ctx = mctx(t.state);
      const k = armed(t, ctx, 'nh:kobold', 6, 1, [['nh:dart', 5]]);
      const between = addMon(t.state, 'nh:newt', 4, 1);
      t.state.entities[String(between)]!.c.hp = { cur: 1, max: 1 };
      const hp0 = heroHp(t);
      thrwmu(ctx, k, clear, null);
      const msgs = text(evs(ctx));
      if (msgs.includes('The newt is killed!')) {
        killed = true;
        expect(heroHp(t)).toBe(hp0); // it never reached her
        expect(t.state.entities[String(between)]).toBeUndefined();
      }
    }
    expect(killed).toBe(true);
  });
});

describe('the hero fires from a launcher', () => {
  function bowSetup(seed = 1, row = ['....................', '..@.................']) {
    const s = levelSetup(row, seed);
    plainKit(s.state);
    for (const e of inventoryOf(s.state, s.state.playerId))
      if (e.c.item?.equipped === 'weapon') e.c.item.equipped = null;
    const bow = s.carry('nh:bow');
    const arrows = s.carry('nh:arrow', { quantity: 1 });
    const hero = s.state.entities[String(s.state.playerId)]!;
    if (hero.c.attributes) {
      hero.c.attributes.dex = 14;
      hero.c.attributes.str = 16;
    }
    return { s, bow, arrows };
  }
  const wield = (s: ReturnType<typeof levelSetup>, id: EntityId) => {
    s.state.entities[String(id)]!.c.item!.equipped = 'weapon';
  };
  const offers = (s: ReturnType<typeof levelSetup>, id: EntityId) =>
    engine
      .query(s.state)
      .actionsFor({ kind: 'item', id })
      .flatMap((o) => (o.action.type === 'mod' ? [o.action.action as string] : []));
  const throwByHand = (s: ReturnType<typeof levelSetup>, id: EntityId, dir: string) => {
    s.mod('nh:throw', { item: id });
    const prompt = s.state.pendingPrompt?.prompt;
    if (!prompt) throw new Error('no prompt');
    return engine.step(s.state, { type: 'answer', promptId: prompt.id, value: dir });
  };
  const fire = (s: ReturnType<typeof levelSetup>, id: EntityId, dir: string) => {
    s.mod('nh:fire', { item: id });
    const prompt = s.state.pendingPrompt?.prompt;
    if (!prompt) throw new Error('no prompt');
    return engine.step(s.state, { type: 'answer', promptId: prompt.id, value: dir });
  };
  const monster = (s: ReturnType<typeof levelSetup>, x: number) => {
    const id = s.state.nextEntityId++;
    const d = defs.monster('nh:newt' as DefId);
    s.state.entities[String(id)] = {
      id,
      def: d.id,
      c: {
        pos: { level: 'dlvl1', x, y: 1 },
        actor: { energy: 0, speed: d.speed },
        hp: { cur: 1000, max: 1000 },
        monster: { level: 0, peaceful: false, asleep: false, lastHero: null },
      },
    };
    return id;
  };

  test('discoverable: fire is offered on ammo only with the matching launcher wielded', () => {
    const { s, bow, arrows } = bowSetup();
    expect(offers(s, arrows)).not.toContain('nh:fire'); // bow not wielded
    expect(offers(s, arrows)).toContain('nh:throw');
    wield(s, bow);
    expect(offers(s, arrows)).toContain('nh:fire');
    expect(offers(s, arrows)).toContain('nh:throw'); // throwing by hand still works
    const bolts = s.carry('nh:crossbow_bolt', { quantity: 3 });
    expect(offers(s, bolts)).not.toContain('nh:fire'); // wrong launcher
    expect(offers(s, s.byLetter('b'))).not.toContain('nh:fire'); // a dagger is not fired
    const darts = s.carry('nh:dart', { quantity: 3 });
    expect(offers(s, darts)).toContain('nh:fire'); // darts need no launcher
  });

  test('asks for a direction, shoots the arrow, and the flight is animated', () => {
    const { s, bow, arrows } = bowSetup();
    wield(s, bow);
    const turn = s.state.turn;
    s.mod('nh:fire', { item: arrows });
    expect(s.state.pendingPrompt?.prompt.kind).toBe('direction');
    const r = engine.step(s.state, {
      type: 'answer',
      promptId: s.state.pendingPrompt!.prompt.id,
      value: 'e',
    });
    expect(s.state.turn).toBe(turn + 1);
    expect(projs(r.events)[0]?.g).toBe('nh:arrow');
    expect(inventoryOf(s.state, s.state.playerId).some((e) => e.def === 'nh:arrow')).toBe(false);
  });

  test('range: an arrow shot from a bow flies one farther than one thrown by hand (half range)', () => {
    // Str 16: range 8; thrown by hand 4; shot +1 = 9
    const landing = (withBow: boolean): { x: number; msgs: string[] } => {
      const { s, bow, arrows } = bowSetup(2, [
        '..............................',
        '..@...........................',
      ]);
      if (withBow) wield(s, bow);
      const r = withBow ? fire(s, arrows, 'e') : throwByHand(s, arrows, 'e');
      const lvl = s.state.levels['dlvl1']!;
      for (let x = 0; x < lvl.width; x++)
        if (itemsAt(defs, s.state, 'dlvl1', x, 1).some((e) => e.def === 'nh:arrow'))
          return { x, msgs: text(r.events) };
      return { x: -1, msgs: text(r.events) };
    };
    const hand = landing(false);
    expect(hand.x).toBe(2 + 4);
    expect(hand.msgs).toContain("You aren't wielding a bow, so you throw your arrow by hand.");
    const shot = landing(true);
    expect(shot.x).toBe(2 + 9);
    expect(shot.msgs).not.toContain("You aren't wielding a bow, so you throw your arrow by hand.");
  });

  test('to-hit: the launcher adds its enchantment and skill; thrown by hand is -4', () => {
    // newt: AC 8, tiny (-2); hero L1, Dex 14, adjacent (+2): base -1 + 8 + 1 + 2 - 2 = 8
    const rate = (mode: 'hand' | 'bow', spe = 0, skill?: number) => {
      let hit = 0;
      const N = 400;
      for (let seed = 1; seed <= N; seed++) {
        const { s, bow, arrows } = bowSetup(seed);
        if (mode === 'bow') {
          wield(s, bow);
          s.state.entities[String(bow)]!.c.item!.spe = spe;
          const d = nhData(s.ctx);
          if (d.skills && skill !== undefined) d.skills['bow'] = skill;
        }
        monster(s, 3);
        const r = mode === 'bow' ? fire(s, arrows, 'e') : throwByHand(s, arrows, 'e');
        if (text(r.events).some((t) => t.includes('hits'))) hit++;
      }
      return hit / N;
    };
    // by hand: 8 - 4 = 4 => 20%
    expect(Math.abs(rate('hand') - 4 / 20)).toBeLessThan(0.06);
    // bow, restricted/unskilled skill (-4), +0: 4 => 20% (no better, but not -4 on top of it)
    expect(Math.abs(rate('bow', 0, 0) - 4 / 20)).toBeLessThan(0.06);
    // expert (+3) with a +2 bow: distance 2 here (target at x=3, hero x=2) => 8 + 2 + 3 = 13 => 65%
    expect(Math.abs(rate('bow', 2, P_EXPERT) - 13 / 20)).toBeLessThan(0.06);
  });

  test('damage: shot arrows do dmgval plus the skill bonus (no Str bonus); by hand rnd(2) + Str', () => {
    const dmgs = (mode: 'hand' | 'bow') => {
      const out: number[] = [];
      for (let seed = 1; seed <= 300; seed++) {
        const { s, bow, arrows } = bowSetup(seed);
        const hero = s.state.entities[String(s.state.playerId)]!;
        if (hero.c.attributes) hero.c.attributes.str = 18; // +2 damage from Str
        if (mode === 'bow') {
          wield(s, bow);
          s.state.entities[String(bow)]!.c.item!.spe = 20; // never misses
          const d = nhData(s.ctx);
          if (d.skills) d.skills['bow'] = P_EXPERT; // +2 damage
        }
        const m = monster(s, 3);
        s.state.entities[String(m)]!.c.monster!.asleep = true; // +2 to hit
        if (mode === 'hand') hero.c.attributes!.dex = 25;
        const hp0 = s.state.entities[String(m)]!.c.hp!.cur;
        if (mode === 'bow') fire(s, arrows, 'e');
        else throwByHand(s, arrows, 'e');
        const hp1 = s.state.entities[String(m)]?.c.hp?.cur ?? hp0;
        if (hp1 < hp0) out.push(hp0 - hp1);
      }
      return out;
    };
    const shot = dmgs('bow');
    expect(shot.length).toBeGreaterThan(200);
    expect(Math.min(...shot)).toBe(1 + 2); // d6 + expert 2
    expect(Math.max(...shot)).toBe(6 + 2);
    const hand = dmgs('hand');
    expect(hand.length).toBeGreaterThan(20);
    expect(Math.min(...hand)).toBe(1 + 2); // rnd(2) + Str 18 (+2)
    expect(Math.max(...hand)).toBe(2 + 2);
  });

  test('arrows that hit break two times in three; those that miss land', () => {
    let gone = 0;
    let kept = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { s, bow, arrows } = bowSetup(seed);
      wield(s, bow);
      s.state.entities[String(bow)]!.c.item!.spe = 20;
      monster(s, 3);
      fire(s, arrows, 'e');
      const onFloor = itemsAt(defs, s.state, 'dlvl1', 3, 1).some((e) => e.def === 'nh:arrow');
      if (onFloor) kept++;
      else gone++;
    }
    expect(gone / (gone + kept)).toBeGreaterThan(0.55);
    expect(gone / (gone + kept)).toBeLessThan(0.78);
  });

  test('multishot: a stack of arrows from a bow at Skilled can fire more than one', () => {
    let volley = false;
    for (let seed = 1; seed <= 80 && !volley; seed++) {
      const { s, bow } = bowSetup(seed);
      wield(s, bow);
      const stack = s.carry('nh:arrow', { quantity: 8 });
      const d = nhData(s.ctx);
      if (d.skills) d.skills['bow'] = P_EXPERT;
      const r = fire(s, stack, 'e');
      if (text(r.events).some((t) => /^You shoot \d+ arrows\.$/.test(t))) volley = true;
    }
    expect(volley).toBe(true);
  });
});
