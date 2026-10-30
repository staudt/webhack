import { describe, expect, test } from 'vitest';
import {
  addToInventory,
  assigninvlet,
  invCount,
  mergable,
  merged,
  mkcorpse,
  mkgold,
  mksobj,
  placeOnFloor,
  removeFromInventory,
  rne,
  splitStack,
  weight,
} from '../src/index';
import { createRng } from '@nh/core';
import { bareState, ctxFor, defs, heroOf, itemOf, obj } from './itemHelpers';

const LEVEL = 'dlvl1';

describe('rne', () => {
  test('is 1..5 below level 15 and capped at level / 3 above', () => {
    const rng = createRng([1, 2, 3, 4]);
    let max = 0;
    for (let i = 0; i < 5000; i++) max = Math.max(max, rne(rng, 2, 1));
    expect(max).toBe(5);
    let max20 = 0;
    for (let i = 0; i < 20000; i++) max20 = Math.max(max20, rne(rng, 2, 30));
    expect(max20).toBeLessThanOrEqual(10);
    expect(max20).toBeGreaterThan(5);
  });

  test('x = 3 gives 1 about two thirds of the time', () => {
    const rng = createRng([9, 8, 7, 6]);
    let ones = 0;
    const n = 30000;
    for (let i = 0; i < n; i++) if (rne(rng, 3, 1) === 1) ones++;
    expect(ones / n).toBeGreaterThan(0.64);
    expect(ones / n).toBeLessThan(0.69);
  });
});

describe('mksobj init distributions', () => {
  const sample = (defId: string, n: number) => {
    const s = bareState(5);
    const ctx = ctxFor(s);
    const out = [];
    for (let i = 0; i < n; i++) out.push(itemOf(s, mksobj(ctx, obj(defId))));
    return out;
  };

  test('weapons: ~1/11 positive, ~(10/11)(1/10) cursed negative, rest mostly uncursed +0', () => {
    const n = 40000;
    const items = sample('nh:dagger', n);
    const pos = items.filter((i) => i.spe > 0).length / n;
    const neg = items.filter((i) => i.spe < 0).length / n;
    expect(pos).toBeGreaterThan(1 / 11 - 0.01);
    expect(pos).toBeLessThan(1 / 11 + 0.01);
    expect(neg).toBeGreaterThan(10 / 110 - 0.01);
    expect(neg).toBeLessThan(10 / 110 + 0.01);
    for (const i of items.filter((x) => x.spe < 0)) expect(i.buc).toBe('cursed');
    // spe > 0 is blessed or uncursed, never cursed
    for (const i of items.filter((x) => x.spe > 0)) expect(i.buc).not.toBe('cursed');
    // plain +0 weapons: blessorcurse(10) -> 1/10 non-uncursed, split evenly
    const plain = items.filter((x) => x.spe === 0);
    const bc = plain.filter((x) => x.buc !== 'uncursed').length / plain.length;
    expect(bc).toBeGreaterThan(0.08);
    expect(bc).toBeLessThan(0.12);
    expect(items.every((x) => x.quantity === 1 && !x.known.buc && !x.known.spe)).toBe(true);
  });

  test('armor: cursed negative ~ (9/10)(1/11), blessed or uncursed positive ~ (1 - that)/10', () => {
    const n = 40000;
    const items = sample('nh:ring_mail', n);
    const cursedNeg = items.filter((i) => i.buc === 'cursed' && i.spe < 0).length / n;
    const expected = 0.9 / 11;
    expect(cursedNeg).toBeGreaterThan(expected - 0.01);
    expect(cursedNeg).toBeLessThan(expected + 0.01);
    const positive = items.filter((i) => i.spe > 0).length / n;
    const pe = (1 - expected) / 10;
    expect(positive).toBeGreaterThan(pe - 0.01);
    expect(positive).toBeLessThan(pe + 0.01);
    expect(items.every((i) => i.quantity === 1)).toBe(true);
  });

  test('potions and scrolls: blessorcurse(4), 1/8 each of cursed and blessed', () => {
    for (const id of ['nh:potion_of_healing', 'nh:scroll_of_identify']) {
      const n = 40000;
      const items = sample(id, n);
      const c = items.filter((i) => i.buc === 'cursed').length / n;
      const b = items.filter((i) => i.buc === 'blessed').length / n;
      expect(c).toBeGreaterThan(0.11);
      expect(c).toBeLessThan(0.14);
      expect(b).toBeGreaterThan(0.11);
      expect(b).toBeLessThan(0.14);
      expect(items.every((i) => i.spe === 0 && i.quantity === 1)).toBe(true);
    }
  });

  test('food: 1 in 6 are a stack of 2, never partly eaten', () => {
    const n = 30000;
    const items = sample('nh:food_ration', n);
    const two = items.filter((i) => i.quantity === 2).length / n;
    expect(two).toBeGreaterThan(1 / 6 - 0.012);
    expect(two).toBeLessThan(1 / 6 + 0.012);
    expect(items.every((i) => i.quantity <= 2 && (i.eaten ?? 0) === 0)).toBe(true);
  });

  test('init: false draws no random numbers and leaves plain defaults', () => {
    const s = bareState(2);
    const before = JSON.stringify(s.rng);
    const ctx = ctxFor(s);
    const it = itemOf(s, mksobj(ctx, obj('nh:long_sword'), { init: false }));
    expect(JSON.stringify(s.rng)).toBe(before);
    expect(it).toMatchObject({ quantity: 1, buc: 'uncursed', spe: 0, carriedBy: null });
    expect(it.age).toBe(Math.max(s.turn, 1));
  });

  test('assigns increasing placed sequence numbers', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = itemOf(s, mksobj(ctx, obj('nh:dagger'), { init: false }));
    const b = itemOf(s, mksobj(ctx, obj('nh:knife'), { init: false }));
    expect(b.placed).toBeGreaterThan(a.placed);
  });

  test('corpses need a monster; mkcorpse records it and the age', () => {
    const s = bareState();
    s.turn = 17;
    const ctx = ctxFor(s);
    expect(() => mksobj(ctx, obj('nh:corpse'))).toThrow();
    const newt = defs.monster('nh:newt');
    const id = mkcorpse(ctx, newt, { at: { level: LEVEL, x: 3, y: 3 } });
    expect(itemOf(s, id)).toMatchObject({ corpseOf: 'nh:newt', age: 17, quantity: 1 });
  });

  test('quantity override and placement', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const id = mksobj(ctx, obj('nh:dagger'), {
      init: false,
      quantity: 4,
      at: { level: LEVEL, x: 2, y: 2 },
    });
    expect(itemOf(s, id).quantity).toBe(4);
    expect(s.entities[String(id)]?.c.pos).toEqual({ level: LEVEL, x: 2, y: 2 });
  });
});

describe('mkgold', () => {
  test('explicit amounts merge into the pile; amount 0 rolls from depth', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const at = { level: 'dlvl1', x: 4, y: 4 };
    const a = mkgold(ctx, 10, at);
    const b = mkgold(ctx, 5, at);
    expect(b).toBe(a);
    expect(itemOf(s, a).quantity).toBe(15);
    // depth 1: mul = rnd(30 / 11 = 2); amount = 1 + rnd(3) * mul <= 7
    const r = mkgold(ctx, 0, { level: 'dlvl1', x: 9, y: 9 });
    const q = itemOf(s, r).quantity;
    expect(q).toBeGreaterThanOrEqual(2);
    expect(q).toBeLessThanOrEqual(7);
  });
});

describe('weight', () => {
  const mk = (id: string, extra: Partial<Parameters<typeof mksobj>[2]> = {}) => {
    const s = bareState();
    const ctx = ctxFor(s);
    const eid = mksobj(ctx, obj(id), { init: false, ...extra });
    return { s, ctx, e: s.entities[String(eid)]! };
  };

  test('quantity times def weight', () => {
    expect(weight(defs, mk('nh:dagger').e)).toBe(10);
    expect(weight(defs, mk('nh:dagger', { quantity: 3 }).e)).toBe(30);
    expect(weight(defs, mk('nh:food_ration').e)).toBe(20);
  });

  test('coins are (n + 50) / 100, at least 1', () => {
    for (const [n, w] of [
      [1, 1],
      [49, 1],
      [50, 1],
      [150, 2],
      [1000, 10],
      [1049, 10],
    ] as const)
      expect(weight(defs, mk('nh:gold_piece', { quantity: n }).e), String(n)).toBe(w);
  });

  test('corpses weigh their monster, scaled when partly eaten', () => {
    const { e, s, ctx } = mk('nh:corpse', { corpseOf: 'nh:jackal' });
    expect(weight(defs, e)).toBe(defs.monster('nh:jackal').weight);
    const it = itemOf(s, e.id);
    it.eaten = Math.trunc(defs.monster('nh:jackal').nutrition / 2);
    expect(weight(defs, e)).toBe(
      Math.trunc(
        (defs.monster('nh:jackal').weight * it.eaten) / defs.monster('nh:jackal').nutrition,
      ),
    );
    void ctx;
  });

  test('partly eaten food scales with the nutrition left and weighs at least 1', () => {
    const { e, s } = mk('nh:food_ration');
    itemOf(s, e.id).eaten = 400;
    expect(weight(defs, e)).toBe(10);
    itemOf(s, e.id).eaten = 1;
    expect(weight(defs, e)).toBe(1);
  });
});

describe('mergable / merged', () => {
  const two = (idA: string, idB = idA) => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = mksobj(ctx, obj(idA), { init: false });
    const b = mksobj(ctx, obj(idB), { init: false });
    return { s, ctx, a, b, ea: s.entities[String(a)]!, eb: s.entities[String(b)]! };
  };

  test('same def, buc and spe merge; the merged stack sums quantities', () => {
    const { s, ctx, ea, eb } = two('nh:dagger');
    expect(mergable(defs, ea, eb)).toBe(true);
    itemOf(s, eb.id).quantity = 2;
    expect(addToInventory(ctx, s.playerId, ea.id)).toBe(ea.id);
    expect(addToInventory(ctx, s.playerId, eb.id)).toBe(ea.id);
    expect(itemOf(s, ea.id).quantity).toBe(3);
    expect(s.entities[String(eb.id)]).toBeUndefined();
  });

  test('different def, buc, spe or eaten amount do not merge', () => {
    const d = two('nh:dagger', 'nh:knife');
    expect(mergable(defs, d.ea, d.eb)).toBe(false);
    const c = two('nh:dagger');
    itemOf(c.s, c.eb.id).buc = 'cursed';
    expect(mergable(defs, c.ea, c.eb)).toBe(false);
    const p = two('nh:dagger');
    itemOf(p.s, p.eb.id).spe = 1;
    expect(mergable(defs, p.ea, p.eb)).toBe(false);
    const f = two('nh:food_ration');
    itemOf(f.s, f.eb.id).eaten = 100;
    expect(mergable(defs, f.ea, f.eb)).toBe(false);
  });

  test('armor never merges, an entity never merges with itself', () => {
    const a = two('nh:small_shield');
    expect(mergable(defs, a.ea, a.eb)).toBe(false);
    const d = two('nh:dagger');
    expect(mergable(defs, d.ea, d.ea)).toBe(false);
  });

  test('coins merge regardless of buc', () => {
    const g = two('nh:gold_piece');
    itemOf(g.s, g.eb.id).buc = 'cursed';
    expect(mergable(defs, g.ea, g.eb)).toBe(true);
  });

  test('corpses merge only for the same monster, with a weighted average age', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = mksobj(ctx, obj('nh:corpse'), { init: false, corpseOf: 'nh:newt' });
    const b = mksobj(ctx, obj('nh:corpse'), { init: false, corpseOf: 'nh:newt' });
    const c = mksobj(ctx, obj('nh:corpse'), { init: false, corpseOf: 'nh:jackal' });
    expect(mergable(defs, s.entities[String(a)]!, s.entities[String(c)]!)).toBe(false);
    itemOf(s, a).age = 10;
    itemOf(s, a).quantity = 3;
    itemOf(s, b).age = 30;
    expect(mergable(defs, s.entities[String(a)]!, s.entities[String(b)]!)).toBe(true);
    expect(addToInventory(ctx, s.playerId, a)).toBe(a);
    expect(addToInventory(ctx, s.playerId, b)).toBe(a);
    expect(itemOf(s, a)).toMatchObject({ quantity: 4, age: 15 }); // (10*3 + 30*1) / 4
  });

  test('known flags are ORed, with a message for the hero', () => {
    const { s, ctx, ea, eb } = two('nh:dagger');
    itemOf(s, eb.id).known.buc = true;
    addToInventory(ctx, s.playerId, ea.id);
    addToInventory(ctx, s.playerId, eb.id);
    expect(itemOf(s, ea.id).known.buc).toBe(true);
    expect(ctx.events).toContainEqual({ type: 'msg', key: 'item.compare' });
  });

  test('a worn incoming stack passes its slot on to an unworn stack (#adjust)', () => {
    const { s, ctx, ea, eb } = two('nh:dagger');
    addToInventory(ctx, s.playerId, ea.id);
    // merged() directly: eb is worn and is being folded into the carried, unworn ea
    itemOf(s, eb.id).equipped = 'weapon';
    expect(merged(ctx, ea, eb)).toBe(true);
    expect(itemOf(s, ea.id).equipped).toBe('weapon');
    expect(s.entities[String(eb.id)]).toBeUndefined();
  });
});

describe('inventory letters', () => {
  const give = (ctx: ReturnType<typeof ctxFor>, id: string, extra = {}) =>
    mksobj(ctx, obj(id), { init: false, carriedBy: ctx.state.playerId, ...extra });
  const letter = (s: ReturnType<typeof bareState>, id: number) => itemOf(s, id).letter;

  test('first items get a, b, c...', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const ids = ['nh:dagger', 'nh:knife', 'nh:spear'].map((d) => give(ctx, d));
    expect(ids.map((i) => letter(s, i))).toEqual(['a', 'b', 'c']);
  });

  test('gold is always $ and does not use up a letter', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const g = give(ctx, 'nh:gold_piece', { quantity: 20 });
    const d = give(ctx, 'nh:dagger');
    expect(letter(s, g)).toBe('$');
    expect(letter(s, d)).toBe('a');
    expect(invCount(ctx, s.playerId)).toBe(1);
    expect(invCount(ctx, s.playerId, true)).toBe(2);
  });

  test('merging keeps the existing letter', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    give(ctx, 'nh:knife');
    const a = give(ctx, 'nh:dagger');
    const again = give(ctx, 'nh:dagger');
    expect(again).toBe(a);
    expect(letter(s, a)).toBe('b');
  });

  test('a dropped item gets its old letter back when picked up and it is free', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = give(ctx, 'nh:dagger');
    give(ctx, 'nh:knife');
    placeOnFloor(ctx, a, LEVEL, 1, 1);
    expect(letter(s, a)).toBeNull();
    // a different item takes the next letter after the last one assigned ('b' -> 'c')
    const c = give(ctx, 'nh:spear');
    expect(letter(s, c)).toBe('c');
    expect(addToInventory(ctx, s.playerId, a)).toBe(a);
    expect(letter(s, a)).toBe('a');
    expect(s.entities[String(a)]?.c.pos).toBeUndefined();
  });

  test('if the old letter is taken the item gets the next free one', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = give(ctx, 'nh:dagger');
    removeFromInventory(ctx, a);
    const k = give(ctx, 'nh:knife'); // next after lastinvnr (a) is b
    expect(letter(s, k)).toBe('b');
    ctx.state.entities[String(k)]!.c.item!.letter = 'a'; // force the clash
    itemOf(s, k).letter = 'a';
    expect(addToInventory(ctx, s.playerId, a)).toBe(a);
    expect(letter(s, a)).toBe('c');
  });

  test('letters cycle a-z then A-Z, wrapping to the first free one', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const ids: number[] = [];
    // Distinct, unmergeable items: vary the enchantment.
    for (let i = 0; i < 52; i++) {
      const id = mksobj(ctx, obj('nh:dagger'), { init: false });
      itemOf(s, id).spe = i;
      ids.push(addToInventory(ctx, s.playerId, id));
    }
    const letters = ids.map((i) => letter(s, i));
    expect(letters[0]).toBe('a');
    expect(letters[25]).toBe('z');
    expect(letters[26]).toBe('A');
    expect(letters[51]).toBe('Z');
    expect(new Set(letters).size).toBe(52);
    // free 'c' and 'D'; the next new item cycles from after 'Z' -> wraps to 'a'... first free is c
    removeFromInventory(ctx, ids[2]!);
    removeFromInventory(ctx, ids[29]!);
    const n = mksobj(ctx, obj('nh:knife'), { init: false, carriedBy: s.playerId });
    expect(letter(s, n)).toBe('c');
    const m = mksobj(ctx, obj('nh:spear'), { init: false, carriedBy: s.playerId });
    expect(letter(s, m)).toBe('D');
    // full: the marker letter
    const x = mksobj(ctx, obj('nh:club'), { init: false, carriedBy: s.playerId });
    expect(letter(s, x)).toBe('#');
  });

  test('monsters get no letters', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const monId = s.nextEntityId++;
    s.entities[String(monId)] = { id: monId, def: 'nh:newt', c: {} };
    const id = mksobj(ctx, obj('nh:dagger'), { init: false, carriedBy: monId });
    expect(itemOf(s, id)).toMatchObject({ carriedBy: monId, letter: null });
  });

  test('assigninvlet is idempotent for an item that already has a free letter', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = give(ctx, 'nh:dagger');
    assigninvlet(ctx, s.playerId, a);
    expect(letter(s, a)).toBe('a');
  });
});

describe('floor stacking and splitting', () => {
  test('dropped items merge into a mergable pile, keeping the pile position', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const a = mksobj(ctx, obj('nh:dagger'), { init: false, at: { level: LEVEL, x: 2, y: 2 } });
    const k = mksobj(ctx, obj('nh:knife'), { init: false, at: { level: LEVEL, x: 2, y: 2 } });
    const placedA = itemOf(s, a).placed;
    const b = mksobj(ctx, obj('nh:dagger'), { init: false, at: { level: LEVEL, x: 2, y: 2 } });
    expect(b).toBe(a);
    expect(itemOf(s, a)).toMatchObject({ quantity: 2, placed: placedA });
    expect(itemOf(s, k).placed).toBeGreaterThan(placedA);
  });

  test('picking up leaves the floor and putting down clears letter and slot', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const id = mksobj(ctx, obj('nh:dagger'), { init: false, carriedBy: s.playerId });
    itemOf(s, id).equipped = 'weapon';
    placeOnFloor(ctx, id, LEVEL, 5, 5);
    expect(itemOf(s, id)).toMatchObject({ carriedBy: null, letter: null, equipped: null });
    expect(s.entities[String(id)]?.c.pos).toEqual({ level: LEVEL, x: 5, y: 5 });
    expect(heroOf(s).c.item).toBeUndefined();
  });

  test('splitStack makes a detached child and reduces the parent', () => {
    const s = bareState();
    const ctx = ctxFor(s);
    const id = mksobj(ctx, obj('nh:dagger'), {
      init: false,
      quantity: 5,
      carriedBy: s.playerId,
    });
    itemOf(s, id).equipped = 'weapon';
    itemOf(s, id).known.buc = true;
    const child = splitStack(ctx, id, 2);
    expect(itemOf(s, id)).toMatchObject({ quantity: 3, equipped: 'weapon', letter: 'a' });
    expect(itemOf(s, child)).toMatchObject({
      quantity: 2,
      equipped: null,
      carriedBy: null,
      letter: null,
    });
    expect(itemOf(s, child).known.buc).toBe(true);
    expect(s.entities[String(child)]?.c.pos).toBeUndefined();
    // dropping the child puts 2 on the floor; picking it up again merges back with the same letter
    const f = placeOnFloor(ctx, child, LEVEL, 1, 1);
    expect(itemOf(s, f).quantity).toBe(2);
    expect(addToInventory(ctx, s.playerId, f)).toBe(id);
    expect(itemOf(s, id).quantity).toBe(5);
    expect(() => splitStack(ctx, id, 5)).toThrow();
    expect(() => splitStack(ctx, id, 0)).toThrow();
  });
});
