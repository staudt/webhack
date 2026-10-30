import { describe, expect, test } from 'vitest';
import { ModLoadError, loadMods, requireTerrains } from '../src/registry';
import type { ModLoadIssue } from '../src/registry';
import type { DefId } from '../src/types/common';
import type { ActionDef, Mod, ModApi, RoleDef, TerrainDef } from '../src/types/mod';

const id = (s: string): DefId => s as DefId;
const bad = <T>(v: unknown): T => v as T;

const terrain = (mod: string, name: string, extra: Record<string, unknown> = {}): TerrainDef =>
  ({
    id: id(`${mod}:${name}`),
    nameKey: `t.${name}`,
    passable: true,
    opaque: false,
    glyph: { ch: '.', fg: '#fff' },
    ...extra,
  }) as TerrainDef;

const role = (mod: string, name: string, extra: Record<string, unknown> = {}): RoleDef =>
  ({
    id: id(`${mod}:${name}`),
    nameKey: `r.${name}`,
    speed: 12,
    glyph: { ch: '@', fg: '#fff' },
    ...extra,
  }) as RoleDef;

const action = (mod: string, name: string, extra: Record<string, unknown> = {}): ActionDef =>
  ({
    id: id(`${mod}:${name}`),
    labelKey: `a.${name}`,
    handles: 'mod',
    offer: () => [],
    perform: () => 100,
    ...extra,
  }) as ActionDef;

const mod = (mid: string, register: (api: ModApi) => void, extra: Partial<Mod> = {}): Mod => ({
  id: mid,
  version: '1.0.0',
  register,
  ...extra,
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

/** Loads a single mod `m` and returns its issues. */
const one = (register: (api: ModApi) => void, extra: Partial<Mod> = {}): readonly ModLoadIssue[] =>
  issuesOf([mod('m', register, extra)]);

describe('happy path', () => {
  const act = action('b', 'zap');
  const reg = loadMods([
    mod('a', (api) => {
      api.defineTerrain(terrain('a', 'floor'));
      api.defineTerrain(terrain('a', 'wall', { passable: false, opaque: true }));
      api.defineRole(role('a', 'valk'));
    }),
    mod(
      'b',
      (api) => {
        api.defineAction(act);
        api.defineAction(action('b', 'move', { handles: 'move' }));
        api.defineTerrain(terrain('b', 'door', { door: 'closed' }));
        api.defineTerrain(terrain('b', 'up', { stairs: 'up' }));
      },
      { dependsOn: ['a'], version: '2.1.0' },
    ),
  ]);

  test('lookups', () => {
    expect(reg.terrain(id('a:floor')).nameKey).toBe('t.floor');
    expect(reg.hasTerrain(id('a:wall'))).toBe(true);
    expect(reg.hasTerrain(id('a:nope'))).toBe(false);
    expect(reg.role(id('a:valk')).speed).toBe(12);
  });

  test('unknown lookups throw', () => {
    expect(() => reg.terrain(id('a:nope'))).toThrow("Unknown terrain 'a:nope'");
    expect(() => reg.role(id('a:nope'))).toThrow("Unknown role 'a:nope'");
  });

  test('lists in registration order', () => {
    expect(reg.terrains.map((t) => t.id)).toEqual(['a:floor', 'a:wall', 'b:door', 'b:up']);
    expect(reg.roles.map((r) => r.id)).toEqual(['a:valk']);
    expect(reg.actions.map((a) => [a.id, a.mod])).toEqual([
      ['b:zap', 'b'],
      ['b:move', 'b'],
    ]);
    expect(reg.actions[0]?.perform).toBe(act.perform);
  });

  test('mods list in load order', () => {
    expect(reg.mods).toEqual([
      { id: 'a', version: '1.0.0' },
      { id: 'b', version: '2.1.0' },
    ]);
  });

  test('registry is frozen', () => {
    expect(Object.isFrozen(reg)).toBe(true);
    expect(() => {
      (reg as unknown as { mods: unknown }).mods = [];
    }).toThrow(TypeError);
  });

  test('empty mod list yields an empty registry', () => {
    const r = loadMods([]);
    expect(r.mods).toEqual([]);
    expect(r.terrains).toEqual([]);
    expect(r.hooks('newLevel')).toEqual([]);
  });

  test('single-codepoint emoji and astral chars count as one char', () => {
    const r = loadMods([
      mod('m', (api) => {
        api.defineTerrain(terrain('m', 'gem', { glyph: { ch: '\u{1F48E}', fg: 'red' } }));
      }),
    ]);
    expect(r.terrain(id('m:gem')).glyph.ch).toBe('\u{1F48E}');
  });
});

describe('hooks', () => {
  const tag = (s: string) => () => {
    void s;
  };
  const fns = {
    a1: tag('a1'),
    a2: tag('a2'),
    b1: tag('b1'),
    c1: tag('c1'),
    c2: tag('c2'),
    d: tag('d'),
  };

  test('priority desc, then mod order, then registration order', () => {
    const reg = loadMods([
      mod('a', (api) => {
        api.on('endOfTurn', fns.a1, { priority: 5 });
        api.on('endOfTurn', fns.a2); // 0
      }),
      mod('b', (api) => {
        api.on('endOfTurn', fns.b1, { priority: 10 });
      }),
      mod('c', (api) => {
        api.on('endOfTurn', fns.c1, { priority: 5 });
        api.on('endOfTurn', fns.c2, { priority: 10 });
        api.on('afterAction', fns.d);
      }),
    ]);
    const hs = reg.hooks('endOfTurn');
    expect(hs.map((h) => h.fn)).toEqual([fns.b1, fns.c2, fns.a1, fns.c1, fns.a2]);
    expect(hs.map((h) => [h.mod, h.priority])).toEqual([
      ['b', 10],
      ['c', 10],
      ['a', 5],
      ['c', 5],
      ['a', 0],
    ]);
    expect(reg.hooks('afterAction').map((h) => h.fn)).toEqual([fns.d]);
  });

  test('registration order breaks ties within one mod; negative priorities sort last', () => {
    const reg = loadMods([
      mod('a', (api) => {
        api.on('newLevel', fns.a1, { priority: -1 });
        api.on('newLevel', fns.a2);
        api.on('newLevel', fns.b1);
      }),
    ]);
    expect(reg.hooks('newLevel').map((h) => h.fn)).toEqual([fns.a2, fns.b1, fns.a1]);
  });

  test('hook names with none registered give []', () => {
    const reg = loadMods([mod('a', (api) => api.on('endOfTurn', fns.a1))]);
    expect(reg.hooks('beforeAction')).toEqual([]);
    expect(reg.hooks('afterAction')).toEqual([]);
    expect(reg.hooks('newLevel')).toEqual([]);
  });
});

describe('mod-level validation', () => {
  test.each(['', 'Bad', '1x', 'a:b', 'a b'])('bad mod id %j', (badId) => {
    const issues = issuesOf([mod(badId, () => {})]);
    expect(issues).toEqual([
      { modId: badId, path: 'id', reason: expect.stringContaining('mod id must match') },
    ]);
  });

  test('non-string mod id is reported as ?', () => {
    const issues = issuesOf([bad<Mod>({ id: 5, version: '1', register: () => {} })]);
    expect(issues[0]).toMatchObject({ modId: '?', path: 'id' });
  });

  test('duplicate mod id', () => {
    const issues = issuesOf([mod('a', () => {}), mod('a', () => {})]);
    expect(issues).toEqual([{ modId: 'a', path: 'id', reason: 'duplicate mod id' }]);
  });

  test.each([[''], [undefined], [5]])('bad version %j', (v) => {
    expect(one(() => {}, { version: bad<string>(v) })).toEqual([
      { modId: 'm', path: 'version', reason: 'must be a non-empty string' },
    ]);
  });

  test('register not a function', () => {
    expect(issuesOf([bad<Mod>({ id: 'm', version: '1' })])).toEqual([
      { modId: 'm', path: 'register', reason: 'must be a function' },
    ]);
  });

  test('register throws (Error and non-Error)', () => {
    expect(
      one(() => {
        throw new Error('boom');
      }),
    ).toEqual([{ modId: 'm', path: 'register', reason: 'threw: boom' }]);
    expect(
      one(() => {
        throw 'str';
      }),
    ).toEqual([{ modId: 'm', path: 'register', reason: 'threw: str' }]);
  });

  test('a throwing register does not stop later mods being checked', () => {
    const issues = issuesOf([
      mod('a', () => {
        throw new Error('x');
      }),
      mod('b', () => {}, { version: '' }),
    ]);
    expect(issues.map((i) => i.modId)).toEqual(['a', 'b']);
  });

  test('dependsOn self', () => {
    expect(one(() => {}, { dependsOn: ['m'] })).toEqual([
      { modId: 'm', path: 'dependsOn', reason: 'mod depends on itself' },
    ]);
  });

  test('dependsOn unknown', () => {
    expect(one(() => {}, { dependsOn: ['zzz'] })).toEqual([
      { modId: 'm', path: 'dependsOn', reason: "depends on unknown mod 'zzz'" },
    ]);
  });

  test('dependsOn listed later fails, listed earlier passes', () => {
    expect(issuesOf([mod('a', () => {}, { dependsOn: ['b'] }), mod('b', () => {})])).toEqual([
      { modId: 'a', path: 'dependsOn', reason: "depends on 'b', which must be listed before it" },
    ]);
    expect(
      loadMods([mod('b', () => {}), mod('a', () => {}, { dependsOn: ['b'] })]).mods,
    ).toHaveLength(2);
  });
});

describe('definition id validation', () => {
  const idIssue = (defId: unknown): readonly ModLoadIssue[] =>
    one((api) => api.defineTerrain(terrain('m', 'x', { id: defId })));

  test.each([
    ['floor', 'no namespace'],
    ['other:floor', 'wrong namespace'],
    ['m:Bad', 'bad name'],
    ['m:', 'empty name'],
    ['m:a:b', 'extra colon'],
    [':a', 'empty namespace'],
  ])('%j (%s)', (defId) => {
    expect(idIssue(defId)).toEqual([
      {
        modId: 'm',
        defId,
        path: 'id',
        reason: expect.stringContaining("terrain id must be 'm:<name>'"),
      },
    ]);
  });

  test('non-string id', () => {
    expect(idIssue(42)).toEqual([
      { modId: 'm', path: 'id', reason: 'terrain id must be a string' },
    ]);
  });

  test('duplicate id within a kind', () => {
    expect(
      one((api) => {
        api.defineTerrain(terrain('m', 'x'));
        api.defineTerrain(terrain('m', 'x'));
      }),
    ).toEqual([{ modId: 'm', defId: 'm:x', path: 'id', reason: 'duplicate definition id' }]);
  });

  test('duplicate id across kinds', () => {
    expect(
      one((api) => {
        api.defineTerrain(terrain('m', 'x'));
        api.defineRole(role('m', 'x'));
        api.defineAction(action('m', 'x'));
      }),
    ).toEqual([
      { modId: 'm', defId: 'm:x', path: 'id', reason: 'duplicate definition id' },
      { modId: 'm', defId: 'm:x', path: 'id', reason: 'duplicate definition id' },
    ]);
  });

  test('a rejected def is not registered', () => {
    let reg;
    expect(() => {
      reg = loadMods([mod('m', (api) => api.defineTerrain(terrain('m', 'x', { id: 'bad' })))]);
    }).toThrow(ModLoadError);
    expect(reg).toBeUndefined();
  });
});

describe('terrain field validation', () => {
  const t = (extra: Record<string, unknown>) =>
    one((api) => api.defineTerrain(terrain('m', 'x', extra)));
  const issue = (path: string, reason: string): ModLoadIssue => ({
    modId: 'm',
    defId: 'm:x',
    path,
    reason,
  });

  test.each([[''], [undefined], [3]])('nameKey %j', (v) => {
    expect(t({ nameKey: v })).toEqual([issue('nameKey', 'must be a non-empty string')]);
  });
  test('passable', () => {
    expect(t({ passable: 'yes' })).toEqual([issue('passable', 'must be a boolean')]);
  });
  test('opaque', () => {
    expect(t({ opaque: undefined })).toEqual([issue('opaque', 'must be a boolean')]);
  });
  test('door', () => {
    expect(t({ door: 'ajar' })).toEqual([issue('door', "must be 'closed', 'open' or 'doorway'")]);
    for (const d of ['closed', 'open', 'doorway'])
      expect(() =>
        loadMods([mod('m', (api) => api.defineTerrain(terrain('m', 'x', { door: d })))]),
      ).not.toThrow();
  });
  test('stairs', () => {
    expect(t({ stairs: 'sideways' })).toEqual([issue('stairs', "must be 'up' or 'down'")]);
    for (const s of ['up', 'down'])
      expect(() =>
        loadMods([mod('m', (api) => api.defineTerrain(terrain('m', 'x', { stairs: s })))]),
      ).not.toThrow();
  });
  test.each([[undefined], [null], ['x']])('glyph missing/invalid %j', (g) => {
    expect(t({ glyph: g })).toEqual([issue('glyph', 'must be { ch, fg }')]);
  });
  test.each([[''], ['ab'], [5], [undefined]])('glyph.ch %j', (ch) => {
    expect(t({ glyph: { ch, fg: 'red' } })).toEqual([
      issue('glyph.ch', 'must be exactly one character'),
    ]);
  });
  test('glyph.ch multi-codepoint emoji (ZWJ/flag) is rejected, single emoji ok', () => {
    expect(t({ glyph: { ch: '\u{1F468}‍\u{1F469}', fg: 'red' } })).toHaveLength(1);
    expect(() =>
      loadMods([
        mod('m', (api) =>
          api.defineTerrain(terrain('m', 'x', { glyph: { ch: '\u{1F600}', fg: 'red' } })),
        ),
      ]),
    ).not.toThrow();
  });
  test.each([[''], [undefined], [1]])('glyph.fg %j', (fg) => {
    expect(t({ glyph: { ch: '.', fg } })).toEqual([
      issue('glyph.fg', 'must be a non-empty string'),
    ]);
  });
});

describe('role field validation', () => {
  const r = (extra: Record<string, unknown>) => one((api) => api.defineRole(role('m', 'x', extra)));
  const issue = (path: string, reason: string): ModLoadIssue => ({
    modId: 'm',
    defId: 'm:x',
    path,
    reason,
  });

  test.each([[0], [1.5], [-3], [NaN], [Infinity], ['12']])('speed %j', (speed) => {
    expect(r({ speed })).toEqual([issue('speed', 'must be a positive integer')]);
  });
  test('speed 1 ok', () => {
    expect(() =>
      loadMods([mod('m', (api) => api.defineRole(role('m', 'x', { speed: 1 })))]),
    ).not.toThrow();
  });
  test('nameKey', () => {
    expect(r({ nameKey: '' })).toEqual([issue('nameKey', 'must be a non-empty string')]);
  });
  test('glyph', () => {
    expect(r({ glyph: undefined })).toEqual([issue('glyph', 'must be { ch, fg }')]);
    expect(r({ glyph: { ch: 'xx', fg: 'red' } })).toEqual([
      issue('glyph.ch', 'must be exactly one character'),
    ]);
  });
});

describe('action validation', () => {
  const a = (extra: Record<string, unknown>) =>
    one((api) => api.defineAction(action('m', 'x', extra)));
  const issue = (path: string, reason: string): ModLoadIssue => ({
    modId: 'm',
    defId: 'm:x',
    path,
    reason,
  });

  test('labelKey', () => {
    expect(a({ labelKey: '' })).toEqual([issue('labelKey', 'must be a non-empty string')]);
  });
  test('offer / perform', () => {
    expect(a({ offer: 1 })).toEqual([issue('offer', 'must be a function')]);
    expect(a({ perform: undefined })).toEqual([issue('perform', 'must be a function')]);
  });
  test('handles invalid', () => {
    expect(a({ handles: 'fly' })).toEqual([
      issue('handles', 'must be one of move, wait, search, answer, mod'),
    ]);
  });
  test('two actions handling move is an error naming the first', () => {
    expect(
      one((api) => {
        api.defineAction(action('m', 'a', { handles: 'move' }));
        api.defineAction(action('m', 'b', { handles: 'move' }));
      }),
    ).toEqual([
      { modId: 'm', defId: 'm:b', path: 'handles', reason: "'move' is already handled by m:a" },
    ]);
  });
  test('duplicate built-in handler across mods', () => {
    expect(
      issuesOf([
        mod('a', (api) => api.defineAction(action('a', 'w', { handles: 'wait' }))),
        mod('b', (api) => api.defineAction(action('b', 'w', { handles: 'wait' }))),
      ]),
    ).toEqual([
      { modId: 'b', defId: 'b:w', path: 'handles', reason: "'wait' is already handled by a:w" },
    ]);
  });
  test("two actions handling 'mod' is fine", () => {
    const reg = loadMods([
      mod('m', (api) => {
        api.defineAction(action('m', 'a'));
        api.defineAction(action('m', 'b'));
      }),
    ]);
    expect(reg.actions).toHaveLength(2);
  });
});

describe('hook validation', () => {
  test('unknown hook name', () => {
    expect(one((api) => api.on(bad<'endOfTurn'>('nope'), () => {}))).toEqual([
      {
        modId: 'm',
        path: "on('nope')",
        reason:
          'unknown hook; expected one of beforeAction, afterAction, endOfTurn, newGame, newLevel',
      },
    ]);
  });
  test.each([[NaN], [Infinity], [-Infinity]])('non-finite priority %j', (priority) => {
    expect(one((api) => api.on('endOfTurn', () => {}, { priority }))).toEqual([
      { modId: 'm', path: "on('endOfTurn').priority", reason: 'must be a finite number' },
    ]);
  });
  test('non-function handler', () => {
    expect(one((api) => api.on('endOfTurn', bad<() => void>('x')))).toEqual([
      { modId: 'm', path: "on('endOfTurn')", reason: 'handler must be a function' },
    ]);
  });
});

describe('calling the api after register() returned', () => {
  test('a stale api used by a later mod during loading fails that mod', () => {
    let stale: ModApi | undefined;
    const issues = issuesOf([
      mod('a', (api) => {
        stale = api;
      }),
      mod('b', () => {
        stale?.defineTerrain(terrain('a', 'late'));
      }),
    ]);
    expect(issues).toEqual([
      {
        modId: 'b',
        path: 'register',
        reason:
          'threw: [a] defineTerrain called after register() returned; registration must be synchronous',
      },
    ]);
  });

  test('a call after loadMods has returned throws immediately', () => {
    let stale: ModApi | undefined;
    const reg = loadMods([
      mod('a', (api) => {
        stale = api;
      }),
    ]);
    expect(() => stale?.defineTerrain(terrain('a', 'late'))).toThrow(/after register\(\) returned/);
    expect(() => stale?.on('endOfTurn', () => {})).toThrow(/on\('endOfTurn'\)/);
    expect(reg.hasTerrain(id('a:late'))).toBe(false);
  });
});

describe('multiple issues', () => {
  const broken = (): readonly Mod[] => [
    mod('a', (api) => {
      api.defineTerrain(
        terrain('a', 'x', { nameKey: '', passable: 1, glyph: { ch: 'zz', fg: '' } }),
      );
      api.defineRole(role('a', 'r', { speed: 0 }));
      api.on(bad<'endOfTurn'>('bogus'), () => {});
    }),
    mod('b', () => {}, { version: '', dependsOn: ['nope'] }),
  ];

  test('all collected, in order', () => {
    const issues = issuesOf(broken());
    expect(issues.map((i) => `${i.modId}/${i.defId ?? '-'}/${i.path}`)).toEqual([
      'a/a:x/nameKey',
      'a/a:x/passable',
      'a/a:x/glyph.ch',
      'a/a:x/glyph.fg',
      'a/a:r/speed',
      "a/-/on('bogus')",
      'b/-/version',
      'b/-/dependsOn',
    ]);
  });

  test('message format', () => {
    let msg = '';
    try {
      loadMods(broken());
    } catch (e) {
      msg = (e as Error).message;
      expect((e as Error).name).toBe('ModLoadError');
    }
    expect(msg).toMatchInlineSnapshot(`
      "Failed to load mods:
        - [a] a:x nameKey: must be a non-empty string
        - [a] a:x passable: must be a boolean
        - [a] a:x glyph.ch: must be exactly one character
        - [a] a:x glyph.fg: must be a non-empty string
        - [a] a:r speed: must be a positive integer
        - [a] on('bogus'): unknown hook; expected one of beforeAction, afterAction, endOfTurn, newGame, newLevel
        - [b] version: must be a non-empty string
        - [b] dependsOn: depends on unknown mod 'nope'"
    `);
  });
});

describe('requireTerrains', () => {
  const reg = loadMods([mod('a', (api) => api.defineTerrain(terrain('a', 'floor')))]);

  test('passes when present (and for empty list)', () => {
    expect(() => requireTerrains(reg, [id('a:floor')], 'gen')).not.toThrow();
    expect(() => requireTerrains(reg, [], 'gen')).not.toThrow();
  });

  test('lists every missing id', () => {
    let err: unknown;
    try {
      requireTerrains(reg, [id('a:floor'), id('a:x'), id('a:y')], 'gen');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModLoadError);
    expect((err as ModLoadError).issues).toEqual([
      { modId: 'gen', defId: 'a:x', path: 'terrain', reason: 'required terrain is not registered' },
      { modId: 'gen', defId: 'a:y', path: 'terrain', reason: 'required terrain is not registered' },
    ]);
  });
});

describe('timers', () => {
  const fire = () => undefined;

  test('defineTimer validates fire', () => {
    const issues = one((api) => api.defineTimer({ id: id('m:t'), fire: bad(42) }));
    expect(issues).toEqual([
      { modId: 'm', defId: 'm:t', path: 'fire', reason: 'must be a function' },
    ]);
  });

  test('defineTimer validates the id namespace', () => {
    const issues = one((api) => api.defineTimer({ id: id('other:t'), fire }));
    expect(issues).toHaveLength(1);
  });

  test('timer() and hasTimer()', () => {
    const t = { id: id('m:t'), fire };
    const reg = loadMods([mod('m', (api) => api.defineTimer(t))]);
    expect(reg.hasTimer(id('m:t'))).toBe(true);
    expect(reg.hasTimer(id('m:u'))).toBe(false);
    expect(reg.timer(id('m:t'))).toBe(t);
  });

  test('unknown timer throws', () => {
    const reg = loadMods([mod('m', () => undefined)]);
    expect(() => reg.timer(id('m:nope'))).toThrow("Unknown timer 'm:nope'");
  });
});
