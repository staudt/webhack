import { loadMods } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { MONSTERS, messagesEn, vanillaMod } from '../src/index';

const byId = (id: string) => {
  const m = MONSTERS.find((d) => d.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};

describe('vanilla monsters', () => {
  test('loads as a mod and registers every monster', () => {
    const registry = loadMods([vanillaMod]);
    for (const m of MONSTERS) expect(registry.isMonster(m.id), m.id).toBe(true);
    expect(registry.monsters.length).toBe(MONSTERS.length);
  });

  test('ids are unique', () => {
    const ids = MONSTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every monster has a name message', () => {
    for (const m of MONSTERS) expect(messagesEn, m.nameKey).toHaveProperty([m.nameKey]);
  });

  test('every attack is physical damage', () => {
    for (const m of MONSTERS) for (const a of m.attacks) expect(a.ad, m.id).toBe('phys');
  });

  test('newt matches include/monsters.h', () => {
    expect(byId('nh:newt')).toMatchObject({
      nameKey: 'nh:newt',
      glyph: { ch: ':', fg: '#ffff55' },
      level: 0,
      speed: 6,
      ac: 8,
      mr: 0,
      alignment: 0,
      attacks: [{ at: 'bite', ad: 'phys', n: 1, d: 2 }],
      size: 'tiny',
      flags: ['swim', 'amphibious', 'animal', 'nohands', 'carnivore', 'hostile'],
      frequency: 5,
      group: null,
      genFlags: ['geno'],
      difficulty: 1,
      brain: 'nh:melee',
    });
  });

  test('jackal is a small group', () => {
    expect(byId('nh:jackal')).toMatchObject({
      glyph: { ch: 'd', fg: '#aa5500' },
      level: 0,
      speed: 12,
      ac: 7,
      mr: 0,
      attacks: [{ at: 'bite', ad: 'phys', n: 1, d: 2 }],
      size: 'small',
      frequency: 3,
      group: 'small',
      difficulty: 1,
    });
  });

  test('hill orc is a large group', () => {
    expect(byId('nh:hill_orc')).toMatchObject({
      glyph: { ch: 'o', fg: '#ffff55' },
      level: 2,
      speed: 9,
      ac: 10,
      alignment: -4,
      size: 'medium',
      frequency: 2,
      group: 'large',
      difficulty: 4,
    });
  });

  test('manes has three attacks and no corpse', () => {
    expect(byId('nh:manes')).toMatchObject({
      attacks: [
        { at: 'claw', ad: 'phys', n: 1, d: 3 },
        { at: 'claw', ad: 'phys', n: 1, d: 3 },
        { at: 'bite', ad: 'phys', n: 1, d: 4 },
      ],
      group: 'large',
      genFlags: ['geno', 'nocorpse'],
    });
  });
});
