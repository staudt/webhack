import { describe, expect, test } from 'vitest';
import { ModLoadError, loadMods } from '../src/registry';
import type { ModLoadIssue } from '../src/registry';
import type { BrainDef, Mod, ModApi, MonsterDef } from '../src/types/mod';

const bad = <T>(v: unknown): T => v as T;
const mod = (mid: string, register: (api: ModApi) => void): Mod => ({
  id: mid,
  version: '1.0.0',
  register,
});

const brain = (name: string, extra: Record<string, unknown> = {}): BrainDef =>
  ({ id: `m:${name}`, act: () => undefined, ...extra }) as BrainDef;

const monster = (name: string, extra: Record<string, unknown> = {}): MonsterDef =>
  ({
    id: `m:${name}`,
    nameKey: `mon.${name}`,
    glyph: { ch: 'F', fg: '#0f0' },
    level: 1,
    speed: 3,
    ac: 8,
    mr: 0,
    alignment: 0,
    attacks: [{ at: 'claw', ad: 'phys', n: 1, d: 3 }],
    size: 'small',
    flags: ['animal'],
    frequency: 2,
    group: null,
    genFlags: [],
    difficulty: 2,
    resists: [],
    conveys: [],
    weight: 100,
    nutrition: 100,
    brain: 'm:b',
    ...extra,
  }) as MonsterDef;

function issuesOf(mods: readonly Mod[]): readonly ModLoadIssue[] {
  try {
    loadMods(mods);
  } catch (e) {
    expect(e).toBeInstanceOf(ModLoadError);
    return (e as ModLoadError).issues;
  }
  throw new Error('expected loadMods to throw');
}

const withMonster = (extra: Record<string, unknown>): readonly ModLoadIssue[] =>
  issuesOf([
    mod('m', (api) => {
      api.defineBrain(brain('b'));
      api.defineMonster(monster('x', extra));
    }),
  ]);

describe('defineMonster validation', () => {
  test('valid monster loads', () => {
    expect(() =>
      loadMods([
        mod('m', (api) => {
          api.defineBrain(brain('b', { movement: () => 1 }));
          api.defineMonster(monster('x'));
        }),
      ]),
    ).not.toThrow();
  });

  test.each([
    ['nameKey', { nameKey: '' }],
    ['glyph', { glyph: null }],
    ['glyph.ch', { glyph: { ch: 'ab', fg: '#fff' } }],
    ['level', { level: 51 }],
    ['level', { level: 1.5 }],
    ['speed', { speed: -1 }],
    ['ac', { ac: 21 }],
    ['mr', { mr: 101 }],
    ['alignment', { alignment: 128 }],
    ['frequency', { frequency: 8 }],
    ['difficulty', { difficulty: -1 }],
    [
      'attacks',
      { attacks: Array.from({ length: 7 }, () => ({ at: 'claw', ad: 'phys', n: 1, d: 1 })) },
    ],
    ['attacks', { attacks: 'nope' }],
    ['attacks[0].at', { attacks: [{ at: 'lick', ad: 'phys', n: 1, d: 1 }] }],
    ['attacks[0].ad', { attacks: [{ at: 'claw', ad: '', n: 1, d: 1 }] }],
    ['attacks[0].n', { attacks: [{ at: 'claw', ad: 'phys', n: -1, d: 1 }] }],
    ['attacks[0].d', { attacks: [{ at: 'claw', ad: 'phys', n: 1, d: 101 }] }],
    ['size', { size: 'enormous' }],
    ['group', { group: 'huge' }],
    ['flags', { flags: [1] }],
    ['flags', { flags: 'animal' }],
    ['genFlags', { genFlags: [''] }],
    ['resists', { resists: 'fire' }],
    ['resists', { resists: [''] }],
    ['resists', { resists: undefined }],
    ['conveys', { conveys: [3] }],
    ['conveys', { conveys: undefined }],
    ['brain', { brain: 5 }],
  ])('rejects bad %s', (path, extra) => {
    const issues = withMonster(extra);
    expect(issues.some((i) => i.path === path && i.defId === 'm:x')).toBe(true);
  });

  test('resists and conveys accept lists of names', () => {
    expect(() =>
      loadMods([
        mod('m', (api) => {
          api.defineBrain(brain('b'));
          api.defineMonster(monster('x', { resists: ['fire', 'cold'], conveys: ['cold'] }));
        }),
      ]),
    ).not.toThrow();
  });

  test('bad monster id', () => {
    const issues = issuesOf([
      mod('m', (api) => {
        api.defineBrain(brain('b'));
        api.defineMonster(monster('x', { id: 'other:x' }));
      }),
    ]);
    expect(issues[0]?.path).toBe('id');
  });
});

describe('defineBrain validation', () => {
  test('act must be a function', () => {
    const issues = issuesOf([mod('m', (api) => api.defineBrain(brain('b', { act: 1 })))]);
    expect(issues).toEqual([
      { modId: 'm', defId: 'm:b', path: 'act', reason: 'must be a function' },
    ]);
  });

  test('movement must be a function when present', () => {
    const issues = issuesOf([mod('m', (api) => api.defineBrain(brain('b', { movement: 'fast' })))]);
    expect(issues.map((i) => i.path)).toEqual(['movement']);
  });

  test('bad brain id', () => {
    const issues = issuesOf([
      mod('m', (api) => api.defineBrain(bad<BrainDef>({ id: 'x:y', act: () => undefined }))),
    ]);
    expect(issues[0]?.path).toBe('id');
  });
});

describe('brain cross references', () => {
  test('unknown brain is reported after all mods load', () => {
    const issues = issuesOf([
      mod('m', (api) => api.defineMonster(monster('x', { brain: 'zz:nope' }))),
      mod('zz', () => undefined),
    ]);
    expect(issues).toEqual([
      { modId: 'm', defId: 'm:x', path: 'brain', reason: "unknown brain 'zz:nope'" },
    ]);
  });

  test('a brain defined by a later mod is fine', () => {
    const reg = loadMods([
      mod('m', (api) => api.defineMonster(monster('x', { brain: 'late:b' }))),
      mod('late', (api) => api.defineBrain({ id: 'late:b', act: () => undefined })),
    ]);
    expect(reg.brain('late:b').id).toBe('late:b');
    expect(reg.monster('m:x').brain).toBe('late:b');
  });
});

describe('monster and brain lookups', () => {
  const reg = loadMods([
    mod('m', (api) => {
      api.defineBrain(brain('b'));
      api.defineMonster(monster('z'));
      api.defineMonster(monster('a'));
      api.on('newGame', () => undefined);
    }),
  ]);

  test('monster/isMonster/brain', () => {
    expect(reg.monster('m:a').nameKey).toBe('mon.a');
    expect(reg.isMonster('m:a')).toBe(true);
    expect(reg.isMonster('m:nope')).toBe(false);
    expect(reg.brain('m:b').id).toBe('m:b');
    expect(() => reg.monster('m:nope')).toThrow("Unknown monster 'm:nope'");
    expect(() => reg.brain('m:nope')).toThrow("Unknown brain 'm:nope'");
  });

  test('monsters list is in registration order', () => {
    expect(reg.monsters.map((m) => m.id)).toEqual(['m:z', 'm:a']);
  });

  test("'newGame' hook is accepted", () => {
    expect(reg.hooks('newGame')).toHaveLength(1);
  });
});
