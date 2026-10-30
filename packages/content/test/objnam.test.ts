import type { EntityId, Msg } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { discover, doname, isKnown, mksobj, nameItem } from '../src/index';
import { bareState, ctxFor, defs, obj, render, itemOf } from './itemHelpers';

const sentence = (item: Msg): string =>
  render({ key: 't', params: { item } }, { ...cat, t: '{item|an}' });
const cat: Record<string, string> = {};
import { messagesEn } from '../src/index';
Object.assign(cat, messagesEn);

function make(
  defId: string,
  o: Parameters<typeof mksobj>[2] = {},
  mutate?: (it: ReturnType<typeof itemOf>) => void,
) {
  const s = bareState(3);
  const ctx = ctxFor(s);
  const id: EntityId = mksobj(ctx, obj(defId), { init: false, ...o });
  const it = itemOf(s, id);
  mutate?.(it);
  return { s, ctx, id, name: () => sentence(nameItem(s, defs, s.entities[String(id)]!)) };
}

describe('item names (structure)', () => {
  test('doname message nests the name and plural key', () => {
    const { s, id } = make('nh:dagger', { quantity: 2 }, (it) => (it.known.buc = true));
    const m = doname(s, defs, s.entities[String(id)]!);
    expect(m.key).toBe('obj.doname');
    expect(m.params).toMatchObject({
      count: { key: 'obj.count', params: { n: 2 } },
      buc: { key: 'obj.buc.uncursed' },
      name: { key: 'nh:dagger.plural' },
      spe: '',
      worn: '',
    });
  });

  test('the registered namer is doname and registry.itemName uses it', () => {
    const { s, id } = make('nh:dagger');
    const e = s.entities[String(id)]!;
    expect(defs.itemName(s, e)).toEqual(doname(s, defs, e));
    expect(nameItem).toBe(doname);
  });

  test('every message key a name can produce exists', () => {
    for (const d of defs.objects) {
      if (d.id === 'nh:corpse') continue;
      expect(cat[d.nameKey], d.nameKey).toBeTypeOf('string');
    }
  });
});

describe('item names (English)', () => {
  test('the Valkyrie kit', () => {
    const spear = make('nh:spear', {}, (it) => {
      it.spe = 1;
      it.known = { buc: true, spe: true };
      it.equipped = 'weapon';
    });
    expect(spear.name()).toBe('an uncursed +1 spear (weapon in hand)');
    const dagger = make('nh:dagger', {}, (it) => (it.known = { buc: true, spe: true }));
    expect(dagger.name()).toBe('an uncursed +0 dagger');
    const shield = make('nh:small_shield', {}, (it) => {
      it.spe = 3;
      it.known = { buc: true, spe: true };
      it.equipped = 'shield';
    });
    discover(ctxFor(shield.s), 'nh:small_shield');
    expect(shield.name()).toBe('an uncursed +3 small shield (being worn)');
    const ration = make('nh:food_ration', {}, (it) => (it.known.buc = true));
    expect(ration.name()).toBe('an uncursed food ration');
  });

  test('unknown BUC and enchantment are not shown', () => {
    expect(make('nh:mace').name()).toBe('a mace');
    expect(make('nh:mace', {}, (it) => (it.known.spe = true)).name()).toBe('a +0 mace');
    expect(make('nh:ring_mail', {}, (it) => (it.known.buc = true)).name()).toBe(
      'an uncursed ring mail',
    );
  });

  test('cursed and blessed prefixes, negative enchantment', () => {
    const m = make('nh:mace', {}, (it) => {
      it.buc = 'cursed';
      it.spe = -2;
      it.known = { buc: true, spe: true };
    });
    expect(m.name()).toBe('a cursed -2 mace');
    const b = make('nh:long_sword', {}, (it) => {
      it.buc = 'blessed';
      it.known.buc = true;
    });
    expect(b.name()).toBe('a blessed long sword');
  });

  test('quantity gives a count, plural and no article', () => {
    expect(make('nh:dagger', { quantity: 2 }).name()).toBe('2 daggers');
    expect(make('nh:knife', { quantity: 3 }).name()).toBe('3 knives');
    expect(make('nh:gold_piece', { quantity: 25 }).name()).toBe('25 gold pieces');
    expect(make('nh:gold_piece', { quantity: 1 }).name()).toBe('a gold piece');
    expect(
      make('nh:potion_of_healing', { quantity: 2 }, (it) => (it.known.buc = true)).name(),
    ).toMatch(/^2 uncursed .* potions$/);
  });

  test('gold never shows BUC', () => {
    expect(make('nh:gold_piece', { quantity: 5 }, (it) => (it.known.buc = true)).name()).toBe(
      '5 gold pieces',
    );
  });

  test('wielded phrasing: bimanual, stacks and non-weapons', () => {
    expect(make('nh:dwarvish_mattock', {}, (it) => (it.equipped = 'weapon')).name()).toMatch(
      /\(weapon in hands\)$/,
    );
    const mattock = make('nh:dwarvish_mattock', {}, (it) => (it.equipped = 'weapon'));
    discover(ctxFor(mattock.s), 'nh:dwarvish_mattock');
    expect(mattock.name()).toBe('a dwarvish mattock (weapon in hands)');
    expect(make('nh:dagger', { quantity: 3 }, (it) => (it.equipped = 'weapon')).name()).toBe(
      '3 daggers (wielded)',
    );
    expect(make('nh:apple', {}, (it) => (it.equipped = 'weapon')).name()).toBe(
      'an apple (wielded)',
    );
  });

  test('fixed descriptions until discovered', () => {
    const d = make('nh:orcish_dagger');
    expect(d.name()).toBe('a crude dagger');
    discover(ctxFor(d.s), 'nh:orcish_dagger');
    expect(d.name()).toBe('an orcish dagger');
    expect(make('nh:orcish_dagger', { quantity: 2 }).name()).toBe('2 crude daggers');
    expect(make('nh:elven_dagger').name()).toBe('a runed dagger');
    expect(make('nh:iron_shoes').name()).toBe('a pair of hard shoes');
    discover(ctxFor(make('nh:iron_shoes').s), 'nh:iron_shoes');
  });

  test('pairs: boots and gloves read "pair of"', () => {
    const shoes = make('nh:iron_shoes', {}, (it) => (it.equipped = 'boots'));
    discover(ctxFor(shoes.s), 'nh:iron_shoes');
    expect(shoes.name()).toBe('a pair of iron shoes (being worn)');
    const two = make('nh:leather_gloves', { quantity: 2 });
    discover(ctxFor(two.s), 'nh:leather_gloves');
    // armor does not merge, but the plural form still reads correctly
    expect(two.name()).toBe('2 pairs of leather gloves');
  });

  test('potions and scrolls use the per-game appearance until identified', () => {
    const p = make('nh:potion_of_healing');
    const app = p.s.appearances['nh:potion_of_healing'];
    expect(app).toBeDefined();
    const expectedLook = cat[defs.appearance(app!).nameKey]!;
    expect(p.name()).toBe(`a ${expectedLook}`);
    discover(ctxFor(p.s), 'nh:potion_of_healing');
    expect(p.name()).toBe('a potion of healing');
    const sc = make('nh:scroll_of_identify');
    expect(sc.name()).toMatch(/^a scroll labeled [A-Z _]+$/);
    discover(ctxFor(sc.s), 'nh:scroll_of_identify');
    expect(sc.name()).toBe('a scroll of identify');
    // "an" before a vowel-led appearance
    expect(sentence({ key: 'nh:orange_potion' })).toBe('an orange potion');
  });

  test('water: clear until known; holy and unholy when the BUC is known', () => {
    expect(make('nh:potion_of_water').name()).toBe('a clear potion');
    const w = make('nh:potion_of_water', {}, (it) => {
      it.buc = 'blessed';
      it.known.buc = true;
    });
    discover(ctxFor(w.s), 'nh:potion_of_water');
    expect(w.name()).toBe('a potion of holy water');
    const u = make('nh:potion_of_water', {}, (it) => {
      it.buc = 'cursed';
      it.known.buc = true;
    });
    discover(ctxFor(u.s), 'nh:potion_of_water');
    expect(u.name()).toBe('a potion of unholy water');
    const plain = make('nh:potion_of_water', {}, (it) => (it.known.buc = true));
    discover(ctxFor(plain.s), 'nh:potion_of_water');
    expect(plain.name()).toBe('an uncursed potion of water');
  });

  test('corpses and partly eaten food', () => {
    expect(make('nh:corpse', { corpseOf: 'nh:newt' }).name()).toBe('a newt corpse');
    expect(make('nh:corpse', { corpseOf: 'nh:jackal', quantity: 2 }).name()).toBe(
      '2 jackal corpses',
    );
    expect(make('nh:food_ration', {}, (it) => (it.eaten = 100)).name()).toBe(
      'a partly eaten food ration',
    );
    expect(
      make('nh:corpse', { corpseOf: 'nh:newt' }, (it) => {
        it.eaten = 3;
        it.known.buc = true;
      }).name(),
    ).toBe('an uncursed partly eaten newt corpse');
  });
});

describe('isKnown', () => {
  test('plain objects are always known; described and shuffled ones need discover()', () => {
    const { s, ctx } = make('nh:dagger');
    expect(isKnown(s, defs, obj('nh:dagger'))).toBe(true);
    expect(isKnown(s, defs, obj('nh:orcish_dagger'))).toBe(false);
    expect(isKnown(s, defs, obj('nh:scroll_of_light'))).toBe(false);
    discover(ctx, obj('nh:scroll_of_light'));
    expect(isKnown(s, defs, obj('nh:scroll_of_light'))).toBe(true);
  });
});
