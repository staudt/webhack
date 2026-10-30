import { loadMods, type Mod } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { APPEARANCES, OBJECTS } from '../src/objects';
import { objectMessagesEn } from '../src/objects.en';

const objectsMod: Mod = {
  id: 'nh',
  version: '0',
  register(api) {
    for (const o of OBJECTS) api.defineObject(o);
    for (const a of APPEARANCES) api.defineAppearance(a);
  },
};

const byId = (id: string) => {
  const o = OBJECTS.find((d) => d.id === id);
  if (!o) throw new Error(`missing ${id}`);
  return o;
};

describe('vanilla objects data', () => {
  test('loads as a mod and registers every object and appearance', () => {
    const registry = loadMods([objectsMod]);
    for (const o of OBJECTS) expect(registry.isObject(o.id), o.id).toBe(true);
    for (const a of APPEARANCES) expect(registry.isAppearance(a.id), a.id).toBe(true);
    expect(registry.objects.length).toBe(OBJECTS.length);
    expect(registry.appearances.length).toBe(APPEARANCES.length);
  });

  test('object and appearance ids are unique', () => {
    const ids = [...OBJECTS, ...APPEARANCES].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every nameKey, descKey and plural has an English message', () => {
    const keys: string[] = [];
    for (const o of OBJECTS) {
      keys.push(o.nameKey, `${o.nameKey}.plural`);
      if (o.descKey) keys.push(o.descKey, `${o.descKey}.plural`);
    }
    for (const a of APPEARANCES) keys.push(a.nameKey, `${a.nameKey}.plural`);
    for (const k of keys) expect(objectMessagesEn[k], k).toBeTypeOf('string');
  });

  test('nameKey equals id', () => {
    for (const o of OBJECTS) expect(o.nameKey, o.id).toBe(o.id);
    for (const a of APPEARANCES) expect(a.nameKey, a.id).toBe(a.id);
  });

  test('potion and scroll appearance pools are complete', () => {
    const potions = APPEARANCES.filter((a) => a.class === 'potion');
    const scrolls = APPEARANCES.filter((a) => a.class === 'scroll');
    expect(potions.length).toBe(25);
    expect(scrolls.length).toBe(41);
    expect(potions.length).toBeGreaterThanOrEqual(4);
    expect(scrolls.length).toBeGreaterThanOrEqual(5);
  });

  test('only water among potions has a fixed description', () => {
    const described = OBJECTS.filter((o) => o.descKey).map((o) => o.id);
    expect(described).toContain('nh:potion_of_water');
    expect(byId('nh:potion_of_healing').descKey).toBeUndefined();
    for (const id of ['nh:potion_of_extra_healing', 'nh:potion_of_full_healing', 'nh:potion_of_see_invisible']) {
      expect(byId(id).descKey, id).toBeUndefined();
    }
    for (const o of OBJECTS.filter((d) => d.class === 'scroll')) expect(o.descKey, o.id).toBeUndefined();
  });

  test('dagger matches objects.h WEAPON("dagger", ...)', () => {
    const d = byId('nh:dagger');
    expect(d.class).toBe('weapon');
    expect(d.glyph.ch).toBe(')');
    expect(d.prob).toBe(30);
    expect(d.weight).toBe(10);
    expect(d.cost).toBe(4);
    expect(d.material).toBe('iron');
    expect(d.merge).toBe(true);
    expect(d.magic).toBe(false);
    expect(d.delay).toBe(0);
    expect(d.weapon).toEqual({
      small: [1, 4],
      large: [1, 3],
      hitBonus: 2,
      skill: 'dagger',
      bimanual: false,
      kind: 'pierce',
    });
  });

  test('spear matches objects.h WEAPON("spear", ...)', () => {
    const s = byId('nh:spear');
    expect(s.prob).toBe(50);
    expect(s.weight).toBe(30);
    expect(s.cost).toBe(3);
    expect(s.weapon).toEqual({
      small: [1, 6],
      large: [1, 8],
      hitBonus: 0,
      skill: 'spear',
      bimanual: false,
      kind: 'pierce',
    });
  });

  test('dwarvish mattock is bimanual and uses pick_axe', () => {
    expect(byId('nh:dwarvish_mattock').weapon).toMatchObject({
      bimanual: true,
      skill: 'pick_axe',
      kind: 'whack',
      hitBonus: -1,
    });
  });

  test('small shield matches objects.h SHIELD("small shield", ...)', () => {
    const s = byId('nh:small_shield');
    expect(s.class).toBe('armor');
    expect(s.glyph.ch).toBe('[');
    expect(s.armor).toEqual({ slot: 'shield', ac: 1, mc: 0 });
    expect(s.weight).toBe(30);
    expect(s.prob).toBe(6);
    expect(s.cost).toBe(3);
    expect(s.material).toBe('wood');
    expect(s.merge).toBe(false);
    expect(s.descKey).toBe('nh:small_shield.desc');
  });

  test('elven mithril-coat is body armor with known name', () => {
    const m = byId('nh:elven_mithril_coat');
    expect(m.armor).toEqual({ slot: 'body', ac: 5, mc: 2 });
    expect(m.material).toBe('mithril');
    expect(m.delay).toBe(1);
    expect(m.weight).toBe(150);
    expect(m.descKey).toBeUndefined();
  });

  test('food ration matches objects.h FOOD("food ration", ...)', () => {
    const f = byId('nh:food_ration');
    expect(f.class).toBe('food');
    expect(f.glyph.ch).toBe('%');
    expect(f.food).toEqual({ nutrition: 800 });
    expect(f.delay).toBe(5);
    expect(f.weight).toBe(20);
    expect(f.prob).toBe(380);
    expect(f.material).toBe('veggy');
    expect(f.merge).toBe(true);
  });

  test('corpse keeps the table values and has no fixed name', () => {
    const c = byId('nh:corpse');
    expect(c.food).toEqual({ nutrition: 0 });
    expect(c.delay).toBe(1);
    expect(c.weight).toBe(0);
    expect(c.material).toBe('flesh');
    expect(objectMessagesEn['nh:corpse']).toBe('{mon} corpse');
    expect(objectMessagesEn['nh:corpse.plural']).toBe('{mon} corpses');
  });

  test('gold piece is a mergeable coin', () => {
    const g = byId('nh:gold_piece');
    expect(g.class).toBe('coin');
    expect(g.glyph.ch).toBe('$');
    expect(g.material).toBe('gold');
    expect(g.weight).toBe(1);
    expect(g.cost).toBe(1);
    expect(g.merge).toBe(true);
  });

  test('potion of healing is known at start and magical', () => {
    const p = byId('nh:potion_of_healing');
    expect(p.class).toBe('potion');
    expect(p.glyph.ch).toBe('!');
    expect(p.prob).toBe(115);
    expect(p.cost).toBe(20);
    expect(p.magic).toBe(true);
    expect(p.material).toBe('glass');
    expect(p.descKey).toBeUndefined();
    expect(objectMessagesEn['nh:potion_of_healing']).toBe('potion of healing');
  });

  test('potion of water has the fixed description "clear potion"', () => {
    const w = byId('nh:potion_of_water');
    expect(w.descKey).toBe('nh:potion_of_water.desc');
    expect(objectMessagesEn['nh:potion_of_water.desc']).toBe('clear potion');
    expect(w.magic).toBe(false);
    expect(w.prob).toBe(80);
  });

  test('scroll of identify matches objects.h SCROLL("identify", ...)', () => {
    const s = byId('nh:scroll_of_identify');
    expect(s.class).toBe('scroll');
    expect(s.glyph.ch).toBe('?');
    expect(s.prob).toBe(180);
    expect(s.cost).toBe(20);
    expect(s.weight).toBe(5);
    expect(s.material).toBe('paper');
    expect(s.magic).toBe(true);
    expect(objectMessagesEn['nh:scroll_of_identify.plural']).toBe('scrolls of identify');
  });

  test('scroll appearances are labeled in upper case', () => {
    expect(objectMessagesEn['nh:scroll_labeled_zelgo_mer']).toBe('scroll labeled ZELGO MER');
    expect(objectMessagesEn['nh:scroll_labeled_zelgo_mer.plural']).toBe('scrolls labeled ZELGO MER');
  });

  test('potion appearances carry the color of their potion', () => {
    const ruby = APPEARANCES.find((a) => a.id === 'nh:ruby_potion');
    expect(ruby?.glyph).toEqual({ ch: '!', fg: '#cc3333' });
    expect(objectMessagesEn['nh:ruby_potion']).toBe('ruby potion');
    expect(objectMessagesEn['nh:ruby_potion.plural']).toBe('ruby potions');
    expect(objectMessagesEn['nh:purple_red_potion']).toBe('purple-red potion');
  });
});
