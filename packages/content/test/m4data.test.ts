import { type DefId, loadMods, type Mod } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { MONSTERS, messagesEn, vanillaMod } from '../src/index';
import { OBJECTS } from '../src/objects';
import { objectMessagesEn } from '../src/objects.en';

const NEW_MONSTERS: DefId[] = [
  'nh:grid_bug',
  'nh:lichen',
  'nh:brown_mold',
  'nh:yellow_mold',
  'nh:green_mold',
  'nh:red_mold',
  'nh:acid_blob',
  'nh:floating_eye',
  'nh:homunculus',
  'nh:centipede',
  'nh:rabid_rat',
];

const NEW_OBJECTS: DefId[] = [
  'nh:dart',
  'nh:arrow',
  'nh:elven_arrow',
  'nh:orcish_arrow',
  'nh:crossbow_bolt',
  'nh:bow',
  'nh:elven_bow',
  'nh:orcish_bow',
  'nh:crossbow',
  'nh:sling',
  'nh:flint_stone',
  'nh:rock',
];

const objectsMod: Mod = {
  id: 'nh',
  version: '0',
  register(api) {
    for (const o of OBJECTS) api.defineObject(o);
  },
};

const monster = (id: string) => {
  const m = MONSTERS.find((d) => d.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};

const object = (id: string) => {
  const o = OBJECTS.find((d) => d.id === id);
  if (!o) throw new Error(`missing ${id}`);
  return o;
};

describe('m4 monsters', () => {
  test('every new monster loads as a mod', () => {
    const registry = loadMods([vanillaMod]);
    for (const id of NEW_MONSTERS) expect(registry.isMonster(id), id).toBe(true);
  });

  test('every new monster has a name message', () => {
    for (const id of NEW_MONSTERS) expect(messagesEn, id).toHaveProperty([monster(id).nameKey]);
  });

  test('grid bug matches monsters.h MON("grid bug", ...)', () => {
    expect(monster('nh:grid_bug')).toMatchObject({
      glyph: { ch: 'x', fg: '#bb44bb' },
      level: 0,
      speed: 12,
      ac: 9,
      mr: 0,
      alignment: 0,
      attacks: [{ at: 'bite', ad: 'elec', n: 1, d: 1 }],
      size: 'tiny',
      flags: ['animal', 'nohands', 'hostile', 'infravisible'],
      frequency: 3,
      group: 'small',
      genFlags: ['geno', 'nocorpse'],
      difficulty: 1,
      weight: 15,
      nutrition: 10,
      resists: ['elec', 'poison'],
      conveys: [],
    });
  });

  test('floating eye matches monsters.h MON("floating eye", ...)', () => {
    expect(monster('nh:floating_eye')).toMatchObject({
      level: 2,
      speed: 1,
      ac: 9,
      mr: 10,
      attacks: [{ at: 'passive', ad: 'plys', n: 0, d: 70 }],
      size: 'small',
      frequency: 5,
      group: null,
      difficulty: 3,
      weight: 10,
      nutrition: 10,
    });
  });

  test('lichen matches monsters.h MON("lichen", ...)', () => {
    expect(monster('nh:lichen')).toMatchObject({
      glyph: { ch: 'F', fg: '#55ff55' },
      level: 0,
      speed: 1,
      ac: 9,
      attacks: [{ at: 'touch', ad: 'stck', n: 0, d: 0 }],
      size: 'small',
      frequency: 4,
      difficulty: 1,
      weight: 20,
      nutrition: 200,
    });
  });

  test('acid blob matches monsters.h MON("acid blob", ...)', () => {
    expect(monster('nh:acid_blob')).toMatchObject({
      level: 1,
      speed: 3,
      ac: 8,
      attacks: [{ at: 'passive', ad: 'acid', n: 1, d: 8 }],
      size: 'tiny',
      frequency: 2,
      difficulty: 2,
      weight: 30,
      nutrition: 10,
      resists: ['sleep', 'poison', 'acid', 'stone'],
      conveys: ['acid', 'stone'],
    });
  });

  test('molds are passive, stationary and never randomly generated with fixed resists', () => {
    expect(monster('nh:brown_mold')).toMatchObject({
      speed: 0,
      attacks: [{ at: 'passive', ad: 'cold', n: 0, d: 6 }],
      resists: ['cold', 'poison'],
    });
    expect(monster('nh:yellow_mold')).toMatchObject({
      attacks: [{ at: 'passive', ad: 'stun', n: 0, d: 4 }],
    });
    expect(monster('nh:green_mold')).toMatchObject({
      attacks: [{ at: 'passive', ad: 'acid', n: 0, d: 4 }],
    });
    expect(monster('nh:red_mold')).toMatchObject({
      attacks: [{ at: 'passive', ad: 'fire', n: 0, d: 4 }],
      flags: expect.arrayContaining(['infravisible']),
    });
  });

  test('homunculus and rabid rat keep their attacks and resistances', () => {
    expect(monster('nh:homunculus')).toMatchObject({
      alignment: -7,
      attacks: [{ at: 'bite', ad: 'slee', n: 1, d: 3 }],
      resists: ['sleep', 'poison'],
      flags: expect.arrayContaining(['fly', 'pois', 'stalk']),
    });
    expect(monster('nh:rabid_rat')).toMatchObject({
      attacks: [{ at: 'bite', ad: 'drco', n: 2, d: 4 }],
      nutrition: 5,
    });
  });

  test('centipede bite is drst', () => {
    expect(monster('nh:centipede')).toMatchObject({
      attacks: [{ at: 'bite', ad: 'drst', n: 1, d: 3 }],
      speed: 4,
      resists: ['poison'],
    });
  });
});

describe('m4 objects', () => {
  test('every new object loads as a mod', () => {
    const registry = loadMods([objectsMod]);
    for (const id of NEW_OBJECTS) expect(registry.isObject(id), id).toBe(true);
  });

  test('every new name, plural and description has an English message', () => {
    for (const id of NEW_OBJECTS) {
      const o = object(id);
      expect(objectMessagesEn[o.nameKey], o.nameKey).toBeTypeOf('string');
      expect(objectMessagesEn[`${o.nameKey}.plural`], `${o.nameKey}.plural`).toBeTypeOf('string');
      if (o.descKey) {
        expect(objectMessagesEn[o.descKey], o.descKey).toBeTypeOf('string');
        expect(objectMessagesEn[`${o.descKey}.plural`], `${o.descKey}.plural`).toBeTypeOf(
          'string',
        );
      }
    }
  });

  test('arrow matches objects.h PROJECTILE("arrow", ...)', () => {
    const a = object('nh:arrow');
    expect(a.class).toBe('weapon');
    expect(a.prob).toBe(55);
    expect(a.weight).toBe(1);
    expect(a.cost).toBe(2);
    expect(a.merge).toBe(true);
    expect(a.descKey).toBeUndefined();
    expect(a.weapon).toEqual({
      small: [1, 6],
      large: [1, 6],
      hitBonus: 0,
      skill: 'bow',
      bimanual: false,
      kind: 'pierce',
      role: 'ammo',
    });
    expect(objectMessagesEn['nh:arrow.plural']).toBe('arrows');
  });

  test('unidentified ammunition uses its objects.h description', () => {
    expect(object('nh:elven_arrow').descKey).toBe('nh:elven_arrow.desc');
    expect(objectMessagesEn['nh:elven_arrow.desc']).toBe('runed arrow');
    expect(object('nh:orcish_arrow').descKey).toBe('nh:orcish_arrow.desc');
    expect(objectMessagesEn['nh:orcish_arrow.desc']).toBe('crude arrow');
    expect(object('nh:crossbow_bolt').descKey).toBeUndefined();
  });

  test('crossbow bolt uses the crossbow skill', () => {
    expect(object('nh:crossbow_bolt').weapon).toMatchObject({
      role: 'ammo',
      skill: 'crossbow',
      small: [1, 4],
      large: [1, 6],
    });
  });

  test('bow is a bow launcher', () => {
    const b = object('nh:bow');
    expect(b.weapon).toMatchObject({ role: 'launcher', skill: 'bow', small: [1, 2] });
    expect(b.prob).toBe(24);
    expect(b.weight).toBe(30);
    expect(b.cost).toBe(60);
    expect(b.merge).toBe(false);
    expect(b.descKey).toBeUndefined();
    expect(object('nh:elven_bow').descKey).toBe('nh:elven_bow.desc');
    expect(object('nh:orcish_bow').descKey).toBe('nh:orcish_bow.desc');
  });

  test('crossbow and sling are launchers with their own skills', () => {
    expect(object('nh:crossbow').weapon).toMatchObject({ role: 'launcher', skill: 'crossbow' });
    expect(object('nh:sling').weapon).toMatchObject({ role: 'launcher', skill: 'sling' });
  });

  test('dart is a hand-thrown missile matching objects.h WEAPON("dart", ...)', () => {
    const d = object('nh:dart');
    expect(d.class).toBe('weapon');
    expect(d.prob).toBe(60);
    expect(d.weight).toBe(1);
    expect(d.cost).toBe(2);
    expect(d.merge).toBe(true);
    expect(d.weapon).toEqual({
      small: [1, 3],
      large: [1, 2],
      hitBonus: 0,
      skill: 'dart',
      bimanual: false,
      kind: 'pierce',
      role: 'missile',
    });
  });

  test('rock is a sling stone in the gem class', () => {
    const r = object('nh:rock');
    expect(r.class).toBe('gem');
    expect(r.glyph).toEqual({ ch: '*', fg: '#aaaaaa' });
    expect(r.prob).toBe(100);
    expect(r.weight).toBe(10);
    expect(r.cost).toBe(0);
    expect(r.merge).toBe(true);
    expect(r.weapon).toMatchObject({ role: 'ammo', skill: 'sling', small: [1, 3], large: [1, 3] });
    expect(r.descKey).toBeUndefined();
  });

  test('flint stone is unidentified as a gray stone', () => {
    const f = object('nh:flint_stone');
    expect(f.class).toBe('gem');
    expect(f.prob).toBe(0);
    expect(f.cost).toBe(1);
    expect(f.weapon).toMatchObject({ role: 'ammo', skill: 'sling', small: [1, 6], large: [1, 6] });
    expect(f.descKey).toBe('nh:flint_stone.desc');
    expect(objectMessagesEn['nh:flint_stone']).toBe('flint stone');
    expect(objectMessagesEn['nh:flint_stone.plural']).toBe('flint stones');
    expect(objectMessagesEn['nh:flint_stone.desc']).toBe('gray stone');
  });

  test('new object plurals read correctly', () => {
    expect(objectMessagesEn['nh:dart.plural']).toBe('darts');
    expect(objectMessagesEn['nh:crossbow_bolt.plural']).toBe('crossbow bolts');
    expect(objectMessagesEn['nh:rock.plural']).toBe('rocks');
    expect(objectMessagesEn['nh:sling.plural']).toBe('slings');
  });
});
