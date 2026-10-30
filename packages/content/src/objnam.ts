// Naming objects for the player. ref: src/objnam.c xname(), doname()
import type { Entity, GameState, ItemNamer, Msg, ObjectDef, Params, Registry } from '@nh/core';
import { isKnown } from './o_init';

/**
 * The message for the item's name without quantity, BUC or suffixes (xname()): the real name
 * when the hero knows the object type, else its appearance (potions, scrolls) or fixed
 * description ("crude dagger"). Plural (`.plural` keys) when the quantity is not 1.
 * Boots and gloves read "pair of ..." in the catalog's names. Corpses nest the monster as `mon`.
 */
function xname(state: Readonly<GameState>, defs: Registry, def: ObjectDef, item: Entity): Msg {
  const it = item.c.item;
  const plural = it !== undefined && it.quantity !== 1 ? '.plural' : '';
  if (def.id === 'nh:corpse' && it?.corpseOf) {
    return { key: `${def.nameKey}${plural}`, params: { mon: `@${it.corpseOf}` } };
  }
  if (isKnown(state, defs, def)) {
    // ref: objnam.c xname() POTION_CLASS: holy/unholy water when the BUC is known
    if (def.id === 'nh:potion_of_water' && it?.known.buc && it.buc !== 'uncursed') {
      return { key: `obj.${it.buc === 'blessed' ? 'holy' : 'unholy'}_water${plural}` };
    }
    return { key: `${def.nameKey}${plural}` };
  }
  const app = state.appearances[def.id];
  const base = app !== undefined && defs.isAppearance(app) ? defs.appearance(app).nameKey : null;
  return { key: `${base ?? def.descKey ?? def.nameKey}${plural}` };
}

/**
 * The full item name, nested in the message `obj.doname` whose template joins the pieces:
 * `{count}{buc}{eaten}{spe}{name}{worn}`. Each piece is '' or carries its own spacing
 * (count and prefixes end with a space, suffixes start with one). The name has no article; the
 * UI adds it with the `{item|an}` modifier, which must not add one when the text starts with a
 * digit (a counted stack). ref: src/objnam.c doname_base(), with implicit_uncursed on, the hero
 * not a Cleric, no poison/erosion/grease/containers/prices, and `dknown` always true.
 */
export function doname(state: Readonly<GameState>, defs: Registry, item: Entity): Msg {
  const it = item.c.item;
  if (!it) return { key: item.def };
  const def = defs.object(item.def);
  const params: Params = { count: '', buc: '', eaten: '', spe: '', name: '', worn: '' };

  params.name = xname(state, defs, def, item);
  if (it.quantity !== 1) params.count = { key: 'obj.count', params: { n: it.quantity } };

  // Known holy/unholy water says so in its name instead of a BUC prefix.
  const holyWater =
    def.id === 'nh:potion_of_water' &&
    isKnown(state, defs, def) &&
    it.known.buc &&
    it.buc !== 'uncursed';
  // With implicit_uncursed, "uncursed" is printed unless the item is charged and fully known;
  // none of our classes is oc_charged, so it is always printed once the BUC is known.
  if (it.known.buc && def.class !== 'coin' && !holyWater) params.buc = { key: `obj.buc.${it.buc}` };

  if (def.class === 'food' && it.eaten) params.eaten = { key: 'obj.eaten' };

  if ((def.class === 'weapon' || def.class === 'armor') && it.known.spe) {
    params.spe = `${it.spe >= 0 ? '+' : '-'}${Math.abs(it.spe)} `; // "%+d "
  }

  if (it.equipped === 'weapon') {
    // ref: doname_base() W_WEP: stacks and non-weapons are "(wielded)", a single weapon is
    // "(weapon in hand)" / "(weapon in hands)" when bimanual. (No ammo/missiles in our subset.)
    if (it.quantity !== 1 || def.class !== 'weapon') params.worn = { key: 'obj.wielded' };
    else {
      params.worn = { key: def.weapon?.bimanual ? 'obj.weapon_in_hands' : 'obj.weapon_in_hand' };
    }
  } else if (it.equipped !== null) {
    params.worn = { key: 'obj.worn' }; // "(being worn)"; no donning/doffing state yet
  }
  return { key: 'obj.doname', params };
}

/** The item namer registered with the registry (`api.setItemNamer`). */
export const nameItem: ItemNamer = doname;
