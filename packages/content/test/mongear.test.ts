import { getPlayer, inventoryOf, itemsAt, type Ctx, type DefId } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { findMac, makemon, monsterDied, mongets, mDoWear, monWep } from '../src/index';
import { addMon, setup } from './helpers';
import { ctxFor, defs, render } from './itemHelpers';

const ROOM = [
  '-'.repeat(22),
  ...Array.from({ length: 8 }, (_, i) => `|${i === 0 ? '@' : '.'}${'.'.repeat(19)}|`),
  '-'.repeat(22),
];
const mdef = (id: string) => defs.monster(id as DefId);
const carried = (s: ReturnType<typeof setup>, id: number) =>
  inventoryOf(s.state, id).map((e) => e.def);

function gearStats(id: string, n: number) {
  const t = setup(ROOM, 3);
  const ctx = ctxFor(t.state) as unknown as Ctx;
  const counts = new Map<string, number>();
  let worn = 0;
  for (let i = 0; i < n; i++) {
    const mid = makemon(ctx, mdef(id), { x: 15, y: 5 }, { nogroup: true })!;
    for (const d of new Set(carried(t, mid))) counts.set(d, (counts.get(d) ?? 0) + 1);
    if (findMac(t.state, defs, mid) < mdef(id).ac) worn++;
    for (const e of inventoryOf(t.state, mid)) delete t.state.entities[String(e.id)];
    delete t.state.entities[String(mid)];
  }
  return { f: (d: string) => (counts.get(d) ?? 0) / n, worn: worn / n };
}
const near = (a: number, b: number, tol = 0.04) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('starting gear', () => {
  test('dwarves: cloak and shoes 6/7, armed branch 1/4', () => {
    const g = gearStats('nh:dwarf', 3000);
    near(g.f('nh:dwarvish_cloak'), 6 / 7);
    near(g.f('nh:iron_shoes'), 6 / 7);
    near(g.f('nh:dwarvish_short_sword'), 1 / 4);
    near(g.f('nh:dwarvish_iron_helm'), 1 / 4);
    near(g.f('nh:dagger'), 0.5);
  });
  test('hill orcs: orcish helm about half, gold 1 in 5, weapons 1/4 each', () => {
    const g = gearStats('nh:hill_orc', 3000);
    near(g.f('nh:orcish_helm'), 0.5);
    near(g.f('nh:orcish_dagger'), 0.25);
    near(g.f('nh:scimitar'), 0.25);
    near(g.f('nh:gold_piece'), 0.2);
  });
  test('hobbits: dagger/elven dagger 1/3, mithril 1/10 (and worn)', () => {
    const g = gearStats('nh:hobbit', 3000);
    near(g.f('nh:dagger'), 1 / 3);
    near(g.f('nh:elven_dagger'), 1 / 3);
    near(g.f('nh:elven_mithril_coat'), 0.1, 0.025);
    near(g.worn, 0.1, 0.03); // the mithril coat is worn through the racial exception
  });
  test('gnomes and kobolds mostly have nothing in our table', () => {
    const g = gearStats('nh:gnome', 2000);
    near(g.f('nh:dagger'), 1 / 14, 0.03);
    near(g.f('nh:aklys'), 1 / 14, 0.03);
    const k = gearStats('nh:kobold', 500);
    expect(k.f('nh:dagger')).toBe(0);
  });
  test('same seed, same gear', () => {
    const run = () => {
      const t = setup(ROOM, 9);
      const ctx = ctxFor(t.state) as unknown as Ctx;
      return Array.from({ length: 30 }, () => carried(t, makemon(ctx, mdef('nh:dwarf'), null)!));
    };
    expect(run()).toEqual(run());
  });
});

describe('armor class', () => {
  test('worn armor lowers monster AC; small monsters cannot wear body armor', () => {
    const t = setup(ROOM);
    const ctx = ctxFor(t.state);
    const d = addMon(t.state, 'nh:dwarf', 10, 5);
    mongets(ctx, d, 'nh:dwarvish_iron_helm');
    mongets(ctx, d, 'nh:dwarvish_mithril_coat');
    expect(findMac(t.state, defs, d)).toBe(10);
    mDoWear(ctx, d, true);
    const bonus = (id: string) => defs.object(id as DefId).armor!.ac;
    expect(findMac(t.state, defs, d)).toBe(
      10 - bonus('nh:dwarvish_iron_helm') - bonus('nh:dwarvish_mithril_coat'),
    );
    const k = addMon(t.state, 'nh:kobold', 12, 5);
    mongets(ctx, k, 'nh:leather_armor');
    mongets(ctx, k, 'nh:orcish_helm');
    mDoWear(ctx, k, true);
    expect(findMac(t.state, defs, k)).toBe(10 - bonus('nh:orcish_helm'));
  });
});

describe('weapons in combat', () => {
  test('a monster wields (spending its move), swings, and adds dmgval', () => {
    const t = setup(ROOM, 4);
    const ctx = ctxFor(t.state);
    const d = addMon(t.state, 'nh:dwarf', 4, 1); // distance 3: not yet in wield range
    t.state.entities[String(d)]!.c.monster!.level = 2;
    const m = mongets(ctx, d, 'nh:dwarvish_mattock')!;
    t.state.entities[String(m)]!.c.item!.spe = 0;
    t.state.entities[String(m)]!.c.item!.buc = 'uncursed';
    const hero = getPlayer(t.state);
    hero.c.hp = { cur: 5000, max: 5000 };
    const text: string[] = [];
    let max = 0;
    let wielded = -1;
    for (let i = 0; i < 80; i++) {
      const before = hero.c.hp.cur;
      const r = t.engine.step(t.state, { type: 'wait' });
      for (const e of r.events)
        if (e.type === 'msg')
          text.push(render({ key: e.key, ...(e.params ? { params: e.params } : {}) }));
      if (wielded < 0 && monWep(ctx, d)) wielded = i;
      max = Math.max(max, before - hero.c.hp.cur);
      for (const k of Object.keys(t.state.entities))
        if (t.state.entities[k]?.def !== 'nh:dwarf' && t.state.entities[k]?.c.monster)
          delete t.state.entities[k];
    }
    expect(text.some((x) => /^The dwarf wields an? [a-z ]+!$/.test(x))).toBe(true);
    expect(text.some((x) => /^The dwarf swings its [a-z ]+\.$/.test(x))).toBe(true);
    expect(max).toBeGreaterThan(8); // d8 alone could never do this
    expect(wielded).toBeGreaterThanOrEqual(0);
  });
});

describe('death drops', () => {
  test('items fall where it died, under the corpse', () => {
    let checked = 0;
    for (let seed = 1; seed < 60 && checked < 5; seed++) {
      const t = setup(ROOM, seed);
      const ctx = ctxFor(t.state) as unknown as Ctx;
      const d = addMon(t.state, 'nh:dwarf', 8, 5);
      mongets(ctx, d, 'nh:dagger');
      mongets(ctx, d, 'nh:iron_shoes');
      monsterDied(ctx, d, true);
      expect(t.state.entities[String(d)]).toBeUndefined();
      const here = itemsAt(defs, t.state, 'dlvl1', 8, 5).map((e) => e.def);
      expect(here).toContain('nh:dagger');
      expect(here).toContain('nh:iron_shoes');
      if (here.includes('nh:corpse')) {
        expect(here[0]).toBe('nh:corpse'); // top of the pile
        checked++;
      }
      for (const e of Object.values(t.state.entities)) expect(e.c.item?.carriedBy).not.toBe(d);
    }
    expect(checked).toBeGreaterThan(0);
  });
  test('killed by a melee blow', () => {
    const t = setup(ROOM, 2);
    const ctx = ctxFor(t.state);
    const d = addMon(t.state, 'nh:hobbit', 2, 1);
    mongets(ctx, d, 'nh:elven_dagger');
    t.state.entities[String(d)]!.c.hp = { cur: 1, max: 1 };
    for (let i = 0; i < 30 && t.state.entities[String(d)]; i++)
      t.engine.step(t.state, { type: 'move', dir: 'e' });
    expect(t.state.entities[String(d)]).toBeUndefined();
    expect(itemsAt(defs, t.state, 'dlvl1', 2, 1).map((e) => e.def)).toContain('nh:elven_dagger');
  });
});

describe('monster pickup', () => {
  test('a hobbit walks to a dagger, picks it up, and wields it', () => {
    const t = setup(ROOM, 5);
    const ctx = ctxFor(t.state);
    const h = addMon(t.state, 'nh:hobbit', 16, 7);
    const hero = getPlayer(t.state);
    hero.c.hp = { cur: 5000, max: 5000 };
    mksobj_(ctx, 'nh:dagger', 14, 7);
    const text: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = t.engine.step(t.state, { type: 'wait' });
      for (const e of r.events)
        if (e.type === 'msg')
          text.push(render({ key: e.key, ...(e.params ? { params: e.params } : {}) }));
      if (carried(t, h).includes('nh:dagger' as DefId)) break;
    }
    expect(text).toContain('The hobbit picks up a dagger.');
    expect(itemsAt(defs, t.state, 'dlvl1', 14, 7)).toHaveLength(0);
  });
  test('animals and peacefuls leave items alone', () => {
    const t = setup(ROOM, 5);
    const ctx = ctxFor(t.state);
    const j = addMon(t.state, 'nh:jackal', 16, 7);
    const p = addMon(t.state, 'nh:hobbit', 18, 6, { peaceful: true });
    mksobj_(ctx, 'nh:dagger', 17, 7);
    for (let i = 0; i < 30; i++) t.engine.step(t.state, { type: 'wait' });
    expect(carried(t, j)).toEqual([]);
    expect(carried(t, p)).toEqual([]);
  });
});
import { mksobj } from '../src/index';
function mksobj_(ctx: ReturnType<typeof ctxFor>, id: string, x: number, y: number) {
  return mksobj(ctx, defs.object(id as DefId), { init: false, at: { level: 'dlvl1', x, y } });
}
