import { getPlayer, inventoryOf, type Buc } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { isKnown } from '../src/index';
import { defs, engine, levelSetup, plainKit } from './itemHelpers';

type Setup = ReturnType<typeof levelSetup>;

const hp = (s: Setup) => {
  const h = getPlayer(s.state).c.hp;
  if (!h) throw new Error('no hp');
  return h;
};
const quaff = (s: Setup, id: number) => s.mod('nh:quaff', { item: id });
/** A potion of `def` with the given BUC in the inventory. */
function make(s: Setup, def: string, buc: Buc, quantity = 1): number {
  const id = s.carry(def, { quantity });
  const it = s.state.entities[String(id)]?.c.item;
  if (!it) throw new Error('no item');
  it.buc = buc;
  return id;
}

describe('quaff: healing', () => {
  test('heals 8 + d(4 + 2 * bcsign, 4) by BUC', () => {
    const ranges: [Buc, number, number][] = [
      ['cursed', 10, 16],
      ['uncursed', 12, 24],
      ['blessed', 14, 32],
    ];
    for (const [buc, lo, hi] of ranges) {
      const seen = new Set<number>();
      for (let seed = 1; seed <= 40; seed++) {
        const s = levelSetup(undefined, seed);
        plainKit(s.state);
        hp(s).cur = 10;
        hp(s).max = 200;
        const id = make(s, 'nh:potion_of_healing', buc);
        quaff(s, id);
        const gain = hp(s).cur - 10;
        expect(gain).toBeGreaterThanOrEqual(lo);
        expect(gain).toBeLessThanOrEqual(hi + 1); // + natural regeneration
        seen.add(gain);
      }
      expect(seen.size).toBeGreaterThan(3);
    }
  });

  test('max HP rises by 1 (0 cursed) only when healed past the maximum', () => {
    for (const [buc, extra] of [
      ['cursed', 0],
      ['uncursed', 1],
      ['blessed', 1],
    ] as const) {
      const s = levelSetup();
      hp(s).cur = 99;
      hp(s).max = 100;
      quaff(s, make(s, 'nh:potion_of_healing', buc));
      expect(hp(s).max).toBe(100 + extra);
      expect(hp(s).cur).toBe(100 + extra);
    }
    const s = levelSetup();
    hp(s).cur = 1;
    hp(s).max = 100;
    quaff(s, make(s, 'nh:potion_of_healing', 'blessed'));
    expect(hp(s).max).toBe(100);
  });

  test('extra healing: max HP +5 blessed, +2 uncursed, +0 cursed', () => {
    for (const [buc, extra] of [
      ['blessed', 5],
      ['uncursed', 2],
      ['cursed', 0],
    ] as const) {
      const s = levelSetup();
      hp(s).cur = 90;
      hp(s).max = 100;
      quaff(s, make(s, 'nh:potion_of_extra_healing', buc));
      expect(hp(s).max).toBe(100 + extra);
      expect(hp(s).cur).toBe(100 + extra);
    }
  });

  test('extra healing heals 16 + d(4 + 2 * bcsign, 8)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = levelSetup(undefined, seed);
      hp(s).cur = 10;
      hp(s).max = 500;
      quaff(s, make(s, 'nh:potion_of_extra_healing', 'uncursed'));
      expect(hp(s).cur - 10).toBeGreaterThanOrEqual(16 + 4);
      expect(hp(s).cur - 10).toBeLessThanOrEqual(16 + 32 + 1);
    }
  });

  test('full healing heals 400 and raises the maximum by 4 + 4 * bcsign when healed past it', () => {
    for (const [buc, extra] of [
      ['blessed', 8],
      ['uncursed', 4],
      ['cursed', 0],
    ] as const) {
      const s = levelSetup();
      hp(s).cur = 50;
      hp(s).max = 100;
      quaff(s, make(s, 'nh:potion_of_full_healing', buc));
      expect(hp(s).max).toBe(100 + extra);
      expect(hp(s).cur).toBe(100 + extra);
    }
  });

  test('healing messages and one move of time', () => {
    const s = levelSetup();
    hp(s).cur = 10;
    const id = make(s, 'nh:potion_of_healing', 'uncursed');
    const turn = s.state.turn;
    const r = quaff(s, id);
    expect(s.text(r)).toContain('You feel better.');
    expect(s.state.turn).toBe(turn + 1);
    const r2 = quaff(s, make(s, 'nh:potion_of_extra_healing', 'uncursed'));
    expect(s.text(r2)).toContain('You feel much better.');
    const r3 = quaff(s, make(s, 'nh:potion_of_full_healing', 'uncursed'));
    expect(s.text(r3)).toContain('You feel completely healed.');
  });
});

describe('quaff: discovery and the stack', () => {
  test('healing is identified by drinking; the stack goes down by one', () => {
    const s = levelSetup();
    const id = make(s, 'nh:potion_of_healing', 'uncursed', 3);
    expect(isKnown(s.state, defs, 'nh:potion_of_healing')).toBe(false);
    quaff(s, id);
    expect(isKnown(s.state, defs, 'nh:potion_of_healing')).toBe(true);
    expect(s.state.entities[String(id)]?.c.item?.quantity).toBe(2);
    quaff(s, id);
    quaff(s, id);
    expect(s.state.entities[String(id)]).toBeUndefined();
    expect(
      inventoryOf(s.state, s.state.playerId).some((e) => e.def === 'nh:potion_of_healing'),
    ).toBe(false);
  });

  test('extra and full healing are identified too', () => {
    const s = levelSetup();
    quaff(s, make(s, 'nh:potion_of_extra_healing', 'cursed'));
    quaff(s, make(s, 'nh:potion_of_full_healing', 'blessed'));
    expect(isKnown(s.state, defs, 'nh:potion_of_extra_healing')).toBe(true);
    expect(isKnown(s.state, defs, 'nh:potion_of_full_healing')).toBe(true);
  });

  test('see invisible is not identified (no visible effect)', () => {
    for (const buc of ['cursed', 'uncursed', 'blessed'] as const) {
      const s = levelSetup();
      const r = quaff(s, make(s, 'nh:potion_of_see_invisible', buc));
      expect(isKnown(s.state, defs, 'nh:potion_of_see_invisible')).toBe(false);
      expect(s.text(r)[0]).toBe(
        buc === 'cursed' ? 'Yecch!  This tastes rotten.' : 'This tastes like fruit juice.',
      );
    }
  });

  test('plain water identifies itself and feeds; holy and unholy water do not identify', () => {
    const s = levelSetup();
    const h = getPlayer(s.state).c.hunger;
    const before = h?.nutrition ?? 0;
    const r = quaff(s, make(s, 'nh:potion_of_water', 'uncursed'));
    expect(s.text(r)).toContain('This tastes like water.');
    expect(isKnown(s.state, defs, 'nh:potion_of_water')).toBe(true);
    // rnd(10) nutrition, less one turn of burning
    expect((getPlayer(s.state).c.hunger?.nutrition ?? 0) - before).toBeGreaterThanOrEqual(0);

    const holy = levelSetup();
    expect(holy.text(quaff(holy, make(holy, 'nh:potion_of_water', 'blessed')))).toContain(
      'You feel full of awe.',
    );
    expect(isKnown(holy.state, defs, 'nh:potion_of_water')).toBe(false);
    const unholy = levelSetup();
    expect(unholy.text(quaff(unholy, make(unholy, 'nh:potion_of_water', 'cursed')))).toContain(
      'You feel full of dread.',
    );
    expect(isKnown(unholy.state, defs, 'nh:potion_of_water')).toBe(false);
  });
});

describe('quaff: discoverability', () => {
  test('actionsFor offers Quaff on potions only', () => {
    const s = levelSetup();
    const p = make(s, 'nh:potion_of_healing', 'uncursed');
    const sc = s.carry('nh:scroll_of_light');
    const offers = (id: number) =>
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id })
        .flatMap((o) => (o.action.type === 'mod' ? [o.action.action as string] : []));
    expect(offers(p)).toContain('nh:quaff');
    expect(offers(sc)).not.toContain('nh:quaff');
    expect(offers(s.byLetter('a'))).not.toContain('nh:quaff');
  });
});
