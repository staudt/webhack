import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { inventoryOf, isItem, itemsAt, shownId, topObjects } from '../src/objects';
import { getLevel, getPlayer } from '../src/state';
import { actionsMod, terrainMod } from './helpers/fakeMods';
import { addItem, heroPos, objectsMod } from './helpers/objectMods';

const engine = createEngine([terrainMod(), actionsMod(), objectsMod()]);
const reg = engine.registry;
const fresh = () => engine.newGame({ seed: 5, width: 40, height: 15 }).state;

describe('shownId', () => {
  test('appearance when mapped, else the def', () => {
    const s = fresh();
    s.appearances['ob:pot_a'] = 'ob:ruby';
    expect(shownId(s, 'ob:pot_a')).toBe('ob:ruby');
    expect(shownId(s, 'ob:pot_b')).toBe('ob:pot_b');
  });
});

describe('isItem', () => {
  test('needs an item component and a registered object def', () => {
    const s = fresh();
    const id = addItem(s, 'ob:apple', { pos: heroPos(s) });
    expect(isItem(reg, s.entities[String(id)]!)).toBe(true);
    expect(isItem(reg, getPlayer(s))).toBe(false);
    const bad = addItem(s, 'nh:hero', { pos: heroPos(s) });
    expect(isItem(reg, s.entities[String(bad)]!)).toBe(false);
    s.entities[String(id)]!.c = { pos: heroPos(s) as never };
    expect(isItem(reg, s.entities[String(id)]!)).toBe(false);
  });
});

describe('itemsAt', () => {
  test('top of pile first: highest placed, ties by lower id; filters', () => {
    const s = fresh();
    const p = heroPos(s);
    const a = addItem(s, 'ob:apple', { pos: p, placed: 1 });
    const b = addItem(s, 'ob:dagger', { pos: p, placed: 5 });
    const c = addItem(s, 'ob:apple', { pos: p, placed: 5 });
    addItem(s, 'ob:apple', { pos: { ...p, level: 'dlvl9' }, placed: 9 }); // other level
    addItem(s, 'ob:apple', { pos: { x: p.x + 1, y: p.y }, placed: 9 }); // other cell
    addItem(s, 'ob:apple', { carriedBy: s.playerId, letter: 'a' }); // carried
    expect(itemsAt(reg, s, s.currentLevel, p.x, p.y).map((e) => e.id)).toEqual([b, c, a]);
  });

  test('creatures are not objects', () => {
    const s = fresh();
    const p = heroPos(s);
    expect(itemsAt(reg, s, s.currentLevel, p.x, p.y)).toEqual([]);
  });

  test('missing placed counts as 0', () => {
    const s = fresh();
    const p = heroPos(s);
    const a = addItem(s, 'ob:apple', { pos: p, placed: 0 });
    const b = addItem(s, 'ob:apple', { pos: p, placed: 1 });
    delete (s.entities[String(a)]!.c.item as { placed?: number }).placed;
    expect(itemsAt(reg, s, s.currentLevel, p.x, p.y).map((e) => e.id)).toEqual([b, a]);
  });
});

describe('topObjects', () => {
  test('one shown id per cell; appearances applied; ties go to the lower id', () => {
    const s = fresh();
    const level = getLevel(s);
    const p = heroPos(s);
    s.appearances['ob:pot_a'] = 'ob:ruby';
    addItem(s, 'ob:apple', { pos: p, placed: 1 });
    addItem(s, 'ob:pot_a', { pos: p, placed: 2 });
    addItem(s, 'ob:pot_b', { pos: p, placed: 2 }); // tie: lower id (pot_a) stays on top
    const q = { x: p.x + 1, y: p.y };
    addItem(s, 'ob:dagger', { pos: q, placed: 1 });
    addItem(s, 'ob:apple', { pos: { ...q, level: 'other' }, placed: 7 });
    addItem(s, 'ob:apple', { carriedBy: s.playerId });
    const top = topObjects(reg, s, level);
    expect([...top.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [p.y * level.width + p.x, 'ob:ruby'],
      [q.y * level.width + q.x, 'ob:dagger'],
    ]);
  });
});

describe('inventoryOf', () => {
  test('letter order $, a-z, A-Z, other, null; ties by id; only that carrier', () => {
    const s = fresh();
    const me = s.playerId;
    const mk = (letter: string | null, carriedBy = me) =>
      addItem(s, 'ob:apple', { carriedBy, letter });
    const nul = mk(null);
    const other = mk('#');
    const capB = mk('B');
    const capA = mk('A');
    const lowB = mk('b');
    const lowA = mk('a');
    const gold = mk('$');
    const dup = mk('a');
    const mon = addItem(s, 'ob:apple', { pos: heroPos(s) });
    mk('a', mon); // carried by someone else
    addItem(s, 'ob:apple', { pos: heroPos(s) }); // floor
    expect(inventoryOf(s, me).map((e) => e.id)).toEqual([
      gold,
      lowA,
      dup,
      lowB,
      capA,
      capB,
      other,
      nul,
    ]);
  });
});
