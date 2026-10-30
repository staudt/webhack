import { describe, expect, test } from 'vitest';
import { ModLoadError, loadMods } from '../src/registry';
import type { ModLoadIssue } from '../src/registry';
import type { Entity } from '../src/types/entity';
import type { Mod, ModApi, ObjectDef } from '../src/types/mod';
import type { GameState } from '../src/types/state';
import { objDef } from './helpers/objectMods';

const mod = (mid: string, register: (api: ModApi) => void): Mod => ({
  id: mid,
  version: '1.0.0',
  register,
});

function issuesOf(mods: readonly Mod[]): readonly ModLoadIssue[] {
  try {
    loadMods(mods);
  } catch (e) {
    expect(e).toBeInstanceOf(ModLoadError);
    return (e as ModLoadError).issues;
  }
  throw new Error('expected loadMods to throw');
}

const withObject = (extra: Record<string, unknown>): readonly ModLoadIssue[] =>
  issuesOf([mod('ob', (api) => api.defineObject(objDef('x', extra as Partial<ObjectDef>)))]);

const WEAPON = {
  small: [1, 6],
  large: [1, 8],
  hitBonus: 0,
  skill: 'dagger',
  bimanual: false,
  kind: 'pierce',
};
const APP = { id: 'ob:ruby', nameKey: 'a', class: 'potion', glyph: { ch: '!', fg: '#f00' } };

describe('defineObject validation', () => {
  test('valid objects load, including weapon, armor and food', () => {
    expect(() =>
      loadMods([
        mod('ob', (api) => {
          api.defineObject(objDef('w', { weapon: WEAPON } as Partial<ObjectDef>));
          api.defineObject(objDef('a', { class: 'armor', armor: { slot: 'helm', ac: 1, mc: 0 } }));
          api.defineObject(
            objDef('f', { class: 'food', food: { nutrition: 5 }, use: () => undefined }),
          );
        }),
      ]),
    ).not.toThrow();
  });

  test.each([
    ['nameKey', { nameKey: '' }],
    ['descKey', { descKey: '' }],
    ['class', { class: 'wand' }],
    ['glyph', { glyph: null }],
    ['glyph.ch', { glyph: { ch: 'ab', fg: '#fff' } }],
    ['prob', { prob: -1 }],
    ['prob', { prob: 1001 }],
    ['prob', { prob: 1.5 }],
    ['weight', { weight: -1 }],
    ['weight', { weight: 100001 }],
    ['cost', { cost: -1 }],
    ['cost', { cost: 100001 }],
    ['delay', { delay: -1 }],
    ['delay', { delay: 101 }],
    ['material', { material: '' }],
    ['material', { material: 3 }],
    ['merge', { merge: 'yes' }],
    ['magic', { magic: 1 }],
    ['weapon.small', { weapon: { ...WEAPON, small: 'd6' } }],
    ['weapon.small', { weapon: { ...WEAPON, small: [1] } }],
    ['weapon.small[0]', { weapon: { ...WEAPON, small: [-1, 6] } }],
    ['weapon.small[1]', { weapon: { ...WEAPON, small: [1, 101] } }],
    ['weapon.large', { weapon: { ...WEAPON, large: null } }],
    ['weapon.large[0]', { weapon: { ...WEAPON, large: [101, 1] } }],
    ['weapon.hitBonus', { weapon: { ...WEAPON, hitBonus: 21 } }],
    ['weapon.hitBonus', { weapon: { ...WEAPON, hitBonus: -21 } }],
    ['weapon.skill', { weapon: { ...WEAPON, skill: '' } }],
    ['weapon.bimanual', { weapon: { ...WEAPON, bimanual: 0 } }],
    ['weapon.kind', { weapon: { ...WEAPON, kind: 'blunt' } }],
    ['armor.slot', { class: 'armor', armor: { slot: 'legs', ac: 1, mc: 0 } }],
    ['armor.ac', { class: 'armor', armor: { slot: 'helm', ac: 21, mc: 0 } }],
    ['armor.mc', { class: 'armor', armor: { slot: 'helm', ac: 1, mc: 4 } }],
    ['armor', { class: 'armor' }],
    ['food.nutrition', { food: { nutrition: 10001 } }],
    ['food.nutrition', { food: { nutrition: -1 } }],
    ['use', { use: 'quaff' }],
  ])('rejects bad %s', (path, extra) => {
    const issues = withObject(extra);
    expect(issues.some((i) => i.path === path && i.defId === 'ob:x')).toBe(true);
  });

  test('bad object id', () => {
    const issues = withObject({ id: 'other:x' });
    expect(issues[0]?.path).toBe('id');
  });

  test('duplicate ids across kinds are rejected', () => {
    const issues = issuesOf([
      mod('ob', (api) => {
        api.defineObject(objDef('x'));
        api.defineAppearance({ ...APP, id: 'ob:x' } as never);
      }),
    ]);
    expect(issues[0]).toMatchObject({ path: 'id', reason: 'duplicate definition id' });
  });
});

describe('defineAppearance validation', () => {
  const withApp = (extra: Record<string, unknown>): readonly ModLoadIssue[] =>
    issuesOf([mod('ob', (api) => api.defineAppearance({ ...APP, ...extra } as never))]);

  test.each([
    ['class', { class: 'ring' }],
    ['glyph', { glyph: 5 }],
    ['glyph.fg', { glyph: { ch: '!', fg: '' } }],
    ['nameKey', { nameKey: '' }],
  ])('rejects bad %s', (path, extra) => {
    expect(withApp(extra).some((i) => i.path === path)).toBe(true);
  });

  test('bad id', () => {
    expect(withApp({ id: 'zz:ruby' })[0]?.path).toBe('id');
  });
});

describe('defineStatus / setItemNamer / RoleDef.movement / MonsterDef extras', () => {
  test('status field and value are checked', () => {
    const issues = issuesOf([
      mod('ob', (api) => api.defineStatus({ id: 'ob:s', field: '', value: 3 } as never)),
    ]);
    expect(issues.map((i) => i.path)).toEqual(['field', 'value']);
  });

  test('setItemNamer must be a function', () => {
    const issues = issuesOf([mod('ob', (api) => api.setItemNamer('x' as never))]);
    expect(issues).toEqual([{ modId: 'ob', path: 'setItemNamer', reason: 'must be a function' }]);
  });

  test('RoleDef.movement must be a function', () => {
    const issues = issuesOf([
      mod('ob', (api) =>
        api.defineRole({
          id: 'ob:r',
          nameKey: 'r',
          speed: 12,
          glyph: { ch: '@', fg: '#fff' },
          movement: 12,
        } as never),
      ),
    ]);
    expect(issues.map((i) => i.path)).toEqual(['movement']);
  });

  test.each([
    ['weight', { weight: -1 }],
    ['weight', { weight: 100001 }],
    ['nutrition', { nutrition: 10001 }],
    ['nutrition', { nutrition: 1.5 }],
  ])('monster rejects bad %s', (path, extra) => {
    const issues = issuesOf([
      mod('m', (api) => {
        api.defineBrain({ id: 'm:b', act: () => undefined });
        api.defineMonster({
          id: 'm:x',
          nameKey: 'x',
          glyph: { ch: 'F', fg: '#0f0' },
          level: 1,
          speed: 3,
          ac: 8,
          mr: 0,
          alignment: 0,
          attacks: [],
          size: 'small',
          flags: [],
          frequency: 2,
          group: null,
          genFlags: [],
          difficulty: 2,
          weight: 100,
          nutrition: 100,
          brain: 'm:b',
          ...extra,
        } as never);
      }),
    ]);
    expect(issues.some((i) => i.path === path)).toBe(true);
  });

  test('late calls throw', () => {
    let api: ModApi | undefined;
    loadMods([mod('ob', (a) => void (api = a))]);
    expect(() => api?.defineObject(objDef('x'))).toThrow(/after register\(\) returned/);
    expect(() => api?.defineAppearance(APP as never)).toThrow(/defineAppearance called after/);
    expect(() => api?.defineStatus({ id: 'ob:s', field: 'f', value: () => 1 })).toThrow(
      /defineStatus called after/,
    );
    expect(() => api?.setItemNamer(() => ({ key: 'x' }))).toThrow(/setItemNamer called after/);
  });
});

describe('lookups and ordering', () => {
  const reg = loadMods([
    mod('ob', (api) => {
      api.defineObject(objDef('b'));
      api.defineObject(objDef('a'));
      api.defineAppearance({ ...APP, id: 'ob:z' } as never);
      api.defineAppearance({ ...APP, id: 'ob:y' } as never);
      api.defineStatus({ id: 'ob:s1', field: 'f', value: () => 1 });
    }),
    mod('cd', (api) => {
      api.defineObject({ ...objDef('c'), id: 'cd:c' });
      api.defineStatus({ id: 'cd:s2', field: 'f', value: () => 2 });
    }),
  ]);

  test('registration order is preserved', () => {
    expect(reg.objects.map((o) => o.id)).toEqual(['ob:b', 'ob:a', 'cd:c']);
    expect(reg.appearances.map((o) => o.id)).toEqual(['ob:z', 'ob:y']);
    expect(reg.statuses.map((o) => o.id)).toEqual(['ob:s1', 'cd:s2']);
  });

  test('lookups', () => {
    expect(reg.object('ob:a').nameKey).toBe('obj.a');
    expect(reg.isObject('ob:a')).toBe(true);
    expect(reg.isObject('ob:z')).toBe(false);
    expect(reg.appearance('ob:z').id).toBe('ob:z');
    expect(reg.isAppearance('ob:z')).toBe(true);
    expect(reg.isAppearance('ob:a')).toBe(false);
  });

  test('unknown ids throw', () => {
    expect(() => reg.object('ob:nope')).toThrow("Unknown object 'ob:nope'");
    expect(() => reg.appearance('ob:nope')).toThrow("Unknown appearance 'ob:nope'");
  });
});

describe('item namer', () => {
  const item = (def: string, quantity = 1): Entity =>
    ({ id: 1, def, c: { item: { quantity } } }) as unknown as Entity;
  const state = (appearances: Record<string, string> = {}, discovered: string[] = []): GameState =>
    ({ appearances, discovered }) as unknown as GameState;
  const base = mod('ob', (api) => {
    api.defineObject(objDef('dagger', { descKey: 'desc.dagger' }));
    api.defineObject(objDef('apple', { class: 'food' }));
    api.defineObject(objDef('pot', { class: 'potion' }));
    api.defineAppearance({ ...APP, id: 'ob:ruby', nameKey: 'app.ruby' } as never);
  });
  const reg = loadMods([base]);

  test('no description: actual name, count = quantity', () => {
    expect(reg.itemName(state(), item('ob:apple', 3))).toEqual({
      key: 'obj.apple',
      params: { count: 3 },
    });
  });

  test('descKey: description until discovered', () => {
    expect(reg.itemName(state(), item('ob:dagger'))).toEqual({
      key: 'desc.dagger',
      params: { count: 1 },
    });
    expect(reg.itemName(state({}, ['ob:dagger']), item('ob:dagger'))).toEqual({
      key: 'obj.dagger',
      params: { count: 1 },
    });
  });

  test('appearance: appearance name until discovered', () => {
    const s = state({ 'ob:pot': 'ob:ruby' });
    expect(reg.itemName(s, item('ob:pot', 2))).toEqual({ key: 'app.ruby', params: { count: 2 } });
    const d = state({ 'ob:pot': 'ob:ruby' }, ['ob:pot']);
    expect(reg.itemName(d, item('ob:pot')).key).toBe('obj.pot');
  });

  test('an item without an item component counts as 1', () => {
    const e = { id: 1, def: 'ob:apple', c: {} } as Entity;
    expect(reg.itemName(state(), e).params).toEqual({ count: 1 });
  });

  test('the last mod to set a namer wins', () => {
    const r = loadMods([
      base,
      mod('m1', (api) => api.setItemNamer(() => ({ key: 'one' }))),
      mod('m2', (api) => api.setItemNamer(() => ({ key: 'two' }))),
    ]);
    expect(r.itemName(state(), item('ob:apple'))).toEqual({ key: 'two' });
  });
});
