import { describe, expect, test } from 'vitest';
import { discover, isKnown, shuffleAll } from '../src/index';
import { bareState, ctxFor, defs, engine, freshState, obj } from './itemHelpers';

const shuffledDefs = (cls: string) =>
  defs.objects.filter((o) => o.class === cls && o.descKey === undefined);

describe('shuffleAll', () => {
  test('newGame assigns every potion (not water) and scroll a distinct appearance of its class', () => {
    const s = freshState(11);
    for (const cls of ['potion', 'scroll'] as const) {
      const objs = shuffledDefs(cls);
      expect(objs.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const o of objs) {
        const a = s.appearances[o.id];
        expect(a, o.id).toBeDefined();
        expect(defs.appearance(a!).class).toBe(cls);
        expect(seen.has(a!), `${o.id} duplicates ${a}`).toBe(false);
        seen.add(a!);
      }
    }
    expect(s.appearances['nh:potion_of_water']).toBeUndefined();
    expect(s.appearances['nh:dagger']).toBeUndefined();
  });

  test('is deterministic per seed and varies between seeds', () => {
    const a = freshState(21).appearances;
    const b = freshState(21).appearances;
    expect(a).toEqual(b);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++)
      seen.add(JSON.stringify(freshState(seed).appearances['nh:potion_of_healing']));
    expect(seen.size).toBeGreaterThan(8);
  });

  test('uses ctx.rng and every appearance is possible for the first object', () => {
    const first = shuffledDefs('potion')[0]!;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 600; seed++) seen.add(freshState(seed).appearances[first.id]!);
    const pool = defs.appearances.filter((x) => x.class === 'potion').length;
    expect(seen.size).toBeGreaterThan(pool - 6);
  });

  test('can be re-run on a state with a fresh rng', () => {
    const s = bareState(4);
    s.appearances = {};
    shuffleAll(ctxFor(s));
    expect(Object.keys(s.appearances).length).toBe(
      shuffledDefs('potion').length + shuffledDefs('scroll').length,
    );
    void engine;
  });
});

describe('discover', () => {
  test('adds to a sorted list once and makes the object known', () => {
    const s = freshState(3);
    const ctx = ctxFor(s);
    expect(isKnown(s, defs, obj('nh:potion_of_healing'))).toBe(false);
    discover(ctx, obj('nh:scroll_of_light'));
    discover(ctx, 'nh:potion_of_healing');
    discover(ctx, obj('nh:potion_of_healing'));
    // the starting small shield is discovered by the kit; the list stays sorted
    expect(s.discovered).toEqual(
      ['nh:potion_of_healing', 'nh:scroll_of_light', 'nh:small_shield'].sort(),
    );
    expect(isKnown(s, defs, obj('nh:potion_of_healing'))).toBe(true);
    expect(isKnown(s, defs, 'nh:scroll_of_light')).toBe(true);
  });
});
