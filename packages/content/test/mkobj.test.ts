import { itemsAt } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { MKOBJ_PROBS, mkgold, mkobj, mkobjAt, rndmonnum } from '../src/index';
import { OBJECTS } from '../src/objects';
import { bareState, ctxFor, defs, engine } from './itemHelpers';

describe('mkobj: the class table', () => {
  test('mkobjprobs sums to 100 in NetHack order', () => {
    expect(MKOBJ_PROBS.reduce((a, c) => a + c.prob, 0)).toBe(100);
    expect(MKOBJ_PROBS.map((c) => c.name)).toEqual([
      'weapon',
      'armor',
      'food',
      'tool',
      'gem',
      'potion',
      'scroll',
      'spellbook',
      'wand',
      'ring',
      'amulet',
    ]);
  });

  test('only implemented classes appear, in NetHack ratios (the rest make nothing)', () => {
    const state = bareState(11);
    const ctx = ctxFor(state);
    const N = 20000;
    const classes = new Map<string, number>();
    let nothing = 0;
    for (let i = 0; i < N; i++) {
      const id = mkobj(ctx, 'random');
      if (id === null) {
        nothing++;
        continue;
      }
      const cls = defs.object(state.entities[String(id)]!.def).class;
      classes.set(cls, (classes.get(cls) ?? 0) + 1);
    }
    const frac = (c: string) => (classes.get(c) ?? 0) / N;
    expect([...classes.keys()].sort()).toEqual(['armor', 'food', 'potion', 'scroll', 'weapon']);
    expect(Math.abs(nothing / N - 0.27)).toBeLessThan(0.015); // tools, gems, wands, rings...
    expect(Math.abs(frac('weapon') - 0.1)).toBeLessThan(0.01);
    expect(Math.abs(frac('armor') - 0.11)).toBeLessThan(0.01);
    expect(Math.abs(frac('food') - 0.2)).toBeLessThan(0.012);
    expect(Math.abs(frac('potion') - 0.16)).toBeLessThan(0.012);
    expect(Math.abs(frac('scroll') - 0.16)).toBeLessThan(0.012);
  });

  test('within a class objects are weighted by prob among the registered ones', () => {
    const state = bareState(12);
    const ctx = ctxFor(state);
    const N = 20000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const id = mkobj(ctx, 'scroll');
      const d = state.entities[String(id!)]!.def;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const scrolls = OBJECTS.filter((o) => o.class === 'scroll');
    const total = scrolls.reduce((a, o) => a + o.prob, 0);
    for (const o of scrolls)
      expect(Math.abs((counts.get(o.id) ?? 0) / N - o.prob / total)).toBeLessThan(0.015);
  });

  test('gold and corpses (prob 0) are never chosen at random', () => {
    const state = bareState(13);
    const ctx = ctxFor(state);
    for (let i = 0; i < 5000; i++) {
      const id = mkobj(ctx, 'random');
      if (id === null) continue;
      const d = state.entities[String(id)]!.def;
      expect(d).not.toBe('nh:gold_piece');
      expect(d).not.toBe('nh:corpse');
    }
  });

  test('mkobjAt puts the object on the floor', () => {
    const state = bareState(14);
    const ctx = ctxFor(state);
    const at = { level: state.currentLevel, x: 3, y: 3 };
    let made = 0;
    for (let i = 0; i < 50; i++) if (mkobjAt(ctx, 'random', at) !== null) made++;
    expect(made).toBeGreaterThan(20);
    expect(itemsAt(defs, state, at.level, 3, 3).length).toBeGreaterThan(0);
  });

  test('rndmonnum gives a monster appropriate to the depth', () => {
    const state = bareState(15);
    const ctx = ctxFor(state);
    for (let i = 0; i < 200; i++) {
      const m = rndmonnum(ctx, 1);
      expect(defs.isMonster(m.id)).toBe(true);
      expect(m.difficulty).toBeLessThanOrEqual(1);
    }
  });

  test('same seed, same objects', () => {
    const run = () => {
      const ctx = ctxFor(bareState(77));
      return Array.from({ length: 200 }, () => {
        const id = mkobj(ctx, 'random');
        const e = id === null ? null : ctx.state.entities[String(id)];
        return e ? [e.def, e.c.item?.quantity, e.c.item?.spe, e.c.item?.buc] : null;
      });
    };
    expect(run()).toEqual(run());
  });
});

describe('mkgold', () => {
  test('amount = 1 + rnd(depth + 2) * rnd(30 / max(12 - depth, 2))', () => {
    for (const depth of [1, 5, 10, 14]) {
      const state = bareState(20 + depth);
      const lvl = state.levels[state.currentLevel]!;
      lvl.depth = depth;
      const ctx = ctxFor(state);
      const maxMul = Math.trunc(30 / Math.max(12 - depth, 2));
      const max = 1 + (depth + 2) * maxMul;
      let seenMax = 0;
      for (let i = 0; i < 500; i++) {
        const id = mkgold(ctx, 0, { level: lvl.id, x: 5, y: 5 });
        // the pile merges: take the delta
        const q = state.entities[String(id)]!.c.item!.quantity;
        expect(q).toBeGreaterThanOrEqual(2);
        expect(q).toBeLessThanOrEqual(max);
        seenMax = Math.max(seenMax, q);
        state.entities[String(id)]!.c.item!.quantity = 0;
        delete state.entities[String(id)];
      }
      expect(seenMax).toBeGreaterThan(max * 0.6);
    }
  });
});

describe('level objects', () => {
  test('fillOrdinaryRoom makes objects only on room floor, never on stairs', () => {
    let rooms = 0;
    let piles = 0;
    let gold = 0;
    let objs = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const { state } = engine.newGame({ seed });
      const level = state.levels['dlvl1']!;
      rooms += level.rooms.length;
      for (const e of Object.values(state.entities)) {
        if (!e.c.item || !e.c.pos) continue;
        const p = e.c.pos;
        const inRoom = level.rooms.some(
          (r) => p.x >= r.lx && p.x <= r.hx && p.y >= r.ly && p.y <= r.hy,
        );
        expect(inRoom).toBe(true);
        const t = level.palette[level.cells[p.y * level.width + p.x]!];
        expect(t).toBe('nh:floor');
        piles++;
        if (e.def === 'nh:gold_piece') {
          gold++;
          expect(e.c.item.quantity).toBeGreaterThanOrEqual(2);
          expect(e.c.item.quantity).toBeLessThanOrEqual(1 + 3 * 2 * 2); // two piles may merge
        } else objs++;
      }
    }
    expect(piles).toBeGreaterThan(0);
    // 1 in 3 rooms get gold; 1/3 * (1 + 1/4) objects attempts per room, 73% implemented
    expect(gold / rooms).toBeGreaterThan(0.27);
    expect(gold / rooms).toBeLessThan(0.37);
    expect(objs / rooms).toBeGreaterThan(0.22);
    expect(objs / rooms).toBeLessThan(0.38);
  });

  test('a new game generates the same level objects for the same seed', () => {
    const sig = (seed: number) => {
      const { state } = engine.newGame({ seed });
      return Object.values(state.entities)
        .filter((e) => e.c.item)
        .map((e) => [e.id, e.def, e.c.pos?.x, e.c.pos?.y, e.c.item?.quantity, e.c.item?.spe]);
    };
    expect(sig(5)).toEqual(sig(5));
    expect(sig(5)).not.toEqual(sig(6));
  });
});
