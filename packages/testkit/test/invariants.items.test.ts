import { vanillaMod } from '@nh/content';
import {
  createEngine,
  getPlayer,
  inventoryOf,
  type EntityId,
  type GameState,
  type Mod,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import { checkInvariants } from '../src/index';

// Content may not define objects yet, so the test brings its own.
const itemMod: Mod = {
  id: 'ti',
  version: '1.0.0',
  register: (api) =>
    api.defineObject({
      id: 'ti:rock',
      nameKey: 'obj.rock',
      class: 'food',
      glyph: { ch: '%', fg: '#fff' },
      prob: 1,
      weight: 1,
      cost: 0,
      material: 'mineral',
      merge: true,
      magic: false,
      delay: 0,
    }),
};
const engine = createEngine([vanillaMod, itemMod]);
const reg = engine.registry;
const DEF = 'ti:rock';

const fresh = (): GameState => {
  const { state } = engine.newGame({ seed: 5 });
  engine.step(state, { type: 'wait' });
  return state;
};
const errs = (s: GameState): string => checkInvariants(s, reg).join('\n');

interface Opts {
  def?: `${string}:${string}`;
  pos?: boolean;
  carriedBy?: number | null;
  letter?: string | null;
  equipped?: import('@nh/core').EquipSlot | null;
  quantity?: number;
}
function add(s: GameState, o: Opts = {}): EntityId {
  const id = s.nextEntityId++;
  const hero = getPlayer(s).c.pos!;
  s.entities[String(id)] = {
    id,
    def: o.def ?? DEF,
    c: {
      ...(o.pos === false ? {} : { pos: { ...hero } }),
      item: {
        quantity: o.quantity ?? 1,
        buc: 'uncursed',
        spe: 0,
        known: { buc: false, spe: false },
        carriedBy: o.carriedBy ?? null,
        letter: o.letter ?? null,
        equipped: o.equipped ?? null,
        placed: 0,
      },
    },
  };
  return id;
}

describe('item invariants', () => {
  test('a floor item sharing a cell with the hero is fine', () => {
    const s = fresh();
    add(s);
    add(s);
    expect(errs(s)).toBe('');
  });

  test('a carried item with a letter is fine', () => {
    const s = fresh();
    add(s, { pos: false, carriedBy: s.playerId, letter: 'y' });
    expect(errs(s)).toBe('');
  });

  test('both pos and carriedBy', () => {
    const s = fresh();
    add(s, { carriedBy: s.playerId });
    expect(errs(s)).toMatch(/either on the floor or carried/);
  });

  test('neither pos nor carriedBy', () => {
    const s = fresh();
    add(s, { pos: false });
    expect(errs(s)).toMatch(/either on the floor or carried/);
  });

  test('carrier missing', () => {
    const s = fresh();
    add(s, { pos: false, carriedBy: 4242 });
    expect(errs(s)).toMatch(/carried by missing entity 4242/);
  });

  test('duplicate letter for the same carrier, but not across carriers', () => {
    const s = fresh();
    const mon = s.nextEntityId++;
    s.entities[String(mon)] = { id: mon, def: getPlayer(s).def, c: {} };
    add(s, { pos: false, carriedBy: s.playerId, letter: 'y' });
    add(s, { pos: false, carriedBy: mon, letter: 'y' });
    expect(errs(s)).not.toMatch(/share letter/);
    add(s, { pos: false, carriedBy: s.playerId, letter: 'y' });
    expect(errs(s)).toMatch(/share letter/);
  });

  test('a floor item may keep its letter but not be equipped', () => {
    let s = fresh();
    add(s, { equipped: 'weapon' });
    expect(errs(s)).toMatch(/floor but equipped/);
    s = fresh();
    add(s, { letter: 'b' });
    expect(errs(s)).toBe('');
  });

  test.each([0, -1, 1.5])('quantity %s', (q) => {
    const s = fresh();
    add(s, { quantity: q });
    expect(errs(s)).toMatch(/not a positive integer/);
  });

  test('unregistered def', () => {
    const s = fresh();
    add(s, { def: 'zz:nothing' });
    expect(errs(s)).toMatch(/'zz:nothing' is not a registered object/);
  });
});

describe('carrier, equipment and hunger invariants', () => {
  const bare = (): GameState => {
    const s = fresh();
    for (const e of inventoryOf(s, s.playerId)) delete s.entities[String(e.id)];
    return s;
  };
  const heroCarries = (s: GameState, o: Opts): EntityId =>
    add(s, { pos: false, carriedBy: s.playerId, letter: 'y', ...o });

  test('two wielded items for one carrier', () => {
    const s = bare();
    heroCarries(s, { equipped: 'weapon', letter: 'x' });
    expect(errs(s)).toBe('');
    heroCarries(s, { equipped: 'weapon', letter: 'z' });
    expect(errs(s)).toMatch(/both occupy slot/);
  });

  test('a monster that is off any level cannot carry', () => {
    const s = bare();
    const mon = s.nextEntityId++;
    s.entities[String(mon)] = { id: mon, def: getPlayer(s).def, c: {} };
    add(s, { pos: false, carriedBy: mon });
    expect(errs(s)).toMatch(/is not on a level/);
    s.entities[String(mon)]!.c.pos = { level: 'nowhere', x: 0, y: 0 };
    expect(errs(s)).toMatch(/is not on a level/);
  });

  test('hero letters must be in $a-zA-Z#', () => {
    const s = bare();
    heroCarries(s, { letter: '#' });
    expect(errs(s)).toBe('');
    heroCarries(s, { letter: '$' });
    expect(errs(s)).toBe('');
    heroCarries(s, { letter: '!' });
    expect(errs(s)).toMatch(/not in \$a-zA-Z#/);
    const t = bare();
    heroCarries(t, { letter: null });
    expect(errs(t)).toMatch(/not in \$a-zA-Z#/);
  });

  test('armor in the wrong slot', () => {
    const s = bare();
    heroCarries(s, { def: 'nh:small_shield', equipped: 'shield' });
    expect(errs(s)).toBe('');
    heroCarries(s, { def: 'nh:small_shield', equipped: 'helm', letter: 'q' });
    expect(errs(s)).toMatch(/worn in slot helm/);
  });

  test('nutrition must be an integer', () => {
    const s = bare();
    getPlayer(s).c.hunger!.nutrition = 12.5;
    expect(errs(s)).toMatch(/nutrition 12.5 is not an integer/);
  });

  test('helpless must lie in the future', () => {
    const s = bare();
    getPlayer(s).c.helpless = { until: s.turn + 3, reasonKey: 'x' };
    expect(errs(s)).toBe('');
    getPlayer(s).c.helpless = { until: s.turn, reasonKey: 'x' };
    expect(errs(s)).toMatch(/helpless until/);
  });
});
