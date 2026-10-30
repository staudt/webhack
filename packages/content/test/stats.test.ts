import { getPlayer, type Ctx, type GameState } from '@nh/core';
import { describe, expect, test } from 'vitest';
import {
  acurrstr,
  calcCapacity,
  findAc,
  findMac,
  heroMovement,
  invWeight,
  mksobj,
  weightCap,
} from '../src/index';
import { bareState, ctxFor, defs, freshState, obj, itemOf } from './itemHelpers';

const status = (id: string) => {
  const d = defs.statuses.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const hero = (s: GameState) => getPlayer(s);
const give = (s: GameState, id: string, extra: Parameters<typeof mksobj>[2] = {}) =>
  mksobj(ctxFor(s), obj(id), { init: false, carriedBy: s.playerId, ...extra });

describe('findAc', () => {
  test('bare hero is AC 10', () => {
    const s = bareState();
    expect(findAc(s, defs, s.playerId)).toBe(10);
  });

  test('+3 small shield worn gives 10 - (1 + 3) = 6', () => {
    const s = bareState();
    const id = give(s, 'nh:small_shield');
    itemOf(s, id).spe = 3;
    itemOf(s, id).equipped = 'shield';
    expect(findAc(s, defs, s.playerId)).toBe(6);
    expect(status('nh:ac').value(s, defs)).toBe(6);
  });

  test('only equipped armor counts; negative enchantment hurts; sums over slots', () => {
    const s = bareState();
    give(s, 'nh:ring_mail'); // carried, not worn
    expect(findAc(s, defs, s.playerId)).toBe(10);
    const mail = give(s, 'nh:ring_mail');
    itemOf(s, mail).equipped = 'body';
    const mailAc = defs.object('nh:ring_mail').armor!.ac;
    expect(findAc(s, defs, s.playerId)).toBe(10 - mailAc);
    const helm = give(s, 'nh:orcish_helm');
    itemOf(s, helm).equipped = 'helm';
    itemOf(s, helm).spe = -2;
    const helmAc = defs.object('nh:orcish_helm').armor!.ac;
    expect(findAc(s, defs, s.playerId)).toBe(10 - mailAc - (helmAc - 2));
  });

  test('a wielded weapon adds nothing, and AC is capped at +/-99', () => {
    const s = bareState();
    const w = give(s, 'nh:dagger');
    itemOf(s, w).equipped = 'weapon';
    expect(findAc(s, defs, s.playerId)).toBe(10);
    const sh = give(s, 'nh:small_shield');
    itemOf(s, sh).equipped = 'shield';
    itemOf(s, sh).spe = 200;
    expect(findAc(s, defs, s.playerId)).toBe(-99);
  });

  test('monsters start from their own AC (find_mac)', () => {
    const s = bareState();
    const id = s.nextEntityId++;
    s.entities[String(id)] = {
      id,
      def: 'nh:hill_orc',
      c: { monster: { level: 1, peaceful: false, asleep: false, lastHero: null } },
    };
    const base = defs.monster('nh:hill_orc').ac;
    expect(findMac(s, defs, id)).toBe(base);
    const helm = mksobj(ctxFor(s), obj('nh:orcish_helm'), { init: false, carriedBy: id });
    itemOf(s, helm).equipped = 'helm';
    expect(findMac(s, defs, id)).toBe(base - defs.object('nh:orcish_helm').armor!.ac);
  });

  test('the ac status keeps the M2 stand-in value while the hero has gear', () => {
    const s = freshState(1);
    expect(hero(s).c.gear).toBeDefined();
    expect(status('nh:ac').value(s, defs)).toBe(hero(s).c.gear!.ac);
  });
});

describe('gold status', () => {
  test('sums coin quantities in the hero inventory only', () => {
    const s = bareState();
    expect(status('nh:gold').value(s, defs)).toBe(0);
    give(s, 'nh:gold_piece', { quantity: 40 });
    give(s, 'nh:gold_piece', { quantity: 2 });
    mksobj(ctxFor(s), obj('nh:gold_piece'), {
      init: false,
      quantity: 100,
      at: { level: 'dlvl1', x: 1, y: 1 },
    });
    expect(status('nh:gold').value(s, defs)).toBe(42);
  });
});

describe('acurrstr', () => {
  test('folds 18/xx and above into 19..25', () => {
    const table: [number, number][] = [
      [3, 3],
      [10, 10],
      [18, 18],
      [19, 19], // 18/01
      [49, 19], // 18/31
      [50, 20], // 18/32
      [99, 20], // 18/81
      [100, 21], // 18/82
      [118, 21], // 18/100
      [121, 21],
      [122, 22],
      [125, 25],
    ];
    for (const [i, o] of table) expect(acurrstr(i), String(i)).toBe(o);
  });
});

describe('encumbrance', () => {
  const setAttrs = (s: GameState, str: number, con: number) => {
    const a = hero(s).c.attributes!;
    a.str = str;
    a.con = con;
  };
  const load = (s: GameState, weight: number) => {
    // weight in dagger units of 10; coins would be too coarse
    give(s, 'nh:dagger', { quantity: Math.ceil(weight / 10) });
  };

  test('weight capacity is 25 * (Str + Con) + 50, at most 1000', () => {
    const s = bareState();
    setAttrs(s, 18, 18);
    expect(weightCap(s, s.playerId)).toBe(950);
    setAttrs(s, 10, 10);
    expect(weightCap(s, s.playerId)).toBe(550);
    setAttrs(s, 118, 25); // 18/100 -> 21, Con 25: 25*46+50 > 1000
    expect(weightCap(s, s.playerId)).toBe(1000);
  });

  test('thresholds follow calc_capacity: (2 * excess / cap) + 1', () => {
    const s = bareState();
    setAttrs(s, 18, 18); // cap 950
    const dagger = give(s, 'nh:dagger', { quantity: 1 });
    const cases: [number, number][] = [
      [950, 0], // exactly at capacity: unencumbered
      [960, 1], // 10 over
      [1424, 1], // excess 474: 948/950 = 0 -> 1
      [1430, 2], // excess 480: 960/950 = 1 -> 2
      [1900, 3], // excess 950: 2 -> 3
      [2380, 4], // excess 1430: 3.01 -> 4
      [2850, 5], // excess 1900: 4 -> 5
      [9000, 5], // capped
    ];
    for (const [w, level] of cases) {
      itemOf(s, dagger).quantity = w / 10;
      expect(invWeight(s, defs, s.playerId) + 950, String(w)).toBe(w);
      expect(calcCapacity(s, defs, s.playerId), String(w)).toBe(level);
    }
    // 1424 is not a multiple of 10: use a quantity of 142 (1420 -> excess 470)
    itemOf(s, dagger).quantity = 142;
    expect(calcCapacity(s, defs, s.playerId)).toBe(1);
  });

  test('the status names the level and is null when unencumbered', () => {
    const s = bareState();
    setAttrs(s, 18, 18);
    expect(status('nh:encumbrance').value(s, defs)).toBeNull();
    load(s, 960);
    expect(status('nh:encumbrance').value(s, defs)).toBe('burdened');
    const d = [...Object.values(s.entities)].find((e) => e.c.item)!;
    const names = ['burdened', 'stressed', 'strained', 'overtaxed', 'overloaded'];
    for (const [w, i] of [
      [1430, 1],
      [1900, 2],
      [2380, 3],
      [2850, 4],
    ] as const) {
      d.c.item!.quantity = w / 10;
      expect(status('nh:encumbrance').value(s, defs)).toBe(names[i]);
    }
  });

  test('gold weighs (n + 50) / 100 for capacity', () => {
    const s = bareState();
    setAttrs(s, 18, 18);
    give(s, 'nh:gold_piece', { quantity: 49 }); // 0, not the 1 weight() would say
    expect(invWeight(s, defs, s.playerId)).toBe(-950);
    itemOf(s, give(s, 'nh:gold_piece')).quantity = 150; // merged stack: 2
    expect(invWeight(s, defs, s.playerId)).toBe(2 - 950);
  });

  test('movement is reduced by encumbrance like u_calc_moveamt', () => {
    const s = bareState();
    setAttrs(s, 18, 18);
    const d = give(s, 'nh:dagger', { quantity: 1 });
    const ctx = { state: s, defs } as unknown as Ctx;
    const role = defs.role('nh:valkyrie');
    expect(role.movement).toBeTypeOf('function');
    const want: [number, number][] = [
      [950, 12],
      [960, 9], // 12 - 12/4
      [1430, 6], // 12 - 12/2
      [1900, 3], // 12 - 36/4
      [2380, 2], // 12 - 84/8
      [2850, 12], // overloaded: no reduction case in the C switch
    ];
    for (const [w, m] of want) {
      itemOf(s, d).quantity = w / 10;
      expect(heroMovement(ctx, s.playerId), String(w)).toBe(m);
      expect(role.movement?.(ctx, s.playerId)).toBe(m);
    }
  });
});
