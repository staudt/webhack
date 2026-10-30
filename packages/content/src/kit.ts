// The Valkyrie's starting inventory. ref: src/u_init.c u_init(), ini_inv(), Valkyrie[]
import type { Buc, Ctx, EntityId } from '@nh/core';
import { addToInventory, mksobj } from './items';
import { discover } from './o_init';
import { skillInit } from './skills';
import type { DefId } from '@nh/core';

/** ref: include/u_init.h struct trobj: type, spe, class, quantity, blessed (null = UNDEF_BLESS) */
interface TrObj {
  id: DefId;
  spe: number;
  quantity: number;
  /** Fixed blessedness, or null to keep the randomly initialized one (UNDEF_BLESS). */
  blessed: boolean | null;
  /** Wielded / worn once added (ref: ini_inv()'s setuwep / setworn for the first weapon and shield). */
  equip: 'weapon' | 'shield' | null;
}

/**
 * ref: src/u_init.c Valkyrie[] (NetHack 5.0): +1 spear, +0 dagger, +3 small shield, food ration.
 */
export const VALKYRIE_KIT: readonly TrObj[] = [
  { id: 'nh:spear', spe: 1, quantity: 1, blessed: null, equip: 'weapon' },
  { id: 'nh:dagger', spe: 0, quantity: 1, blessed: null, equip: null },
  { id: 'nh:small_shield', spe: 3, quantity: 1, blessed: null, equip: 'shield' },
  { id: 'nh:food_ration', spe: 0, quantity: 1, blessed: false, equip: null },
];

/**
 * Creates the kit as the hero's inventory (letters a, b, c, d), wields and wears it, discovers
 * the types that have a description, then sets the starting skills.
 * ref: src/u_init.c ini_inv() and ini_inv_adjust_obj(): each object is made with mksobj(init),
 * its curse removed (a random blessing is kept for UNDEF_BLESS entries), enchantment and
 * quantity fixed, and BUC and enchantment identified. Simplified: the dagger is not made the
 * alternate weapon (no secondary-weapon slot), and the food ration's quantity is fixed at 1
 * (mksobj's 1-in-6 chance of two is not rolled into the starting kit).
 */
export function giveStartingKit(ctx: Ctx, heroId: EntityId): void {
  for (const t of VALKYRIE_KIT) {
    const def = ctx.defs.object(t.id);
    const made = mksobj(ctx, def, { init: true });
    const it = ctx.state.entities[String(made)]?.c.item;
    if (!it) throw new Error('starting kit: no item');
    const buc: Buc = it.buc === 'blessed' ? 'blessed' : 'uncursed'; // obj->cursed = 0
    it.buc = t.blessed === null ? buc : t.blessed ? 'blessed' : 'uncursed';
    it.spe = t.spe;
    it.quantity = t.quantity;
    it.known = { buc: true, spe: true };
    const id = addToInventory(ctx, heroId, made);
    if (t.equip) {
      const item = ctx.state.entities[String(id)]?.c.item;
      if (item) item.equipped = t.equip;
    }
    // ref: ini_inv(): objects with a description are discovered when their enchantment is known
    if (def.descKey !== undefined) discover(ctx, def);
  }
  skillInit(ctx, heroId);
}
