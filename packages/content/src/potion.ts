// Potions: quaffing and the effects of the potions in our subset.
// ref: src/potion.c dodrink(), dopotion(), peffects(), healup()
import {
  NORMAL_SPEED,
  type ActionDef,
  type Ctx,
  type DefId,
  type Entity,
  type EntityId,
  type Offer,
  type PlayerAction,
} from '@nh/core';
import { HERO_ALIGN_TYPE } from './generation';
import { newuhs, makeSick } from './hunger';
import { encumberMsg } from './itemactions';
import { bcsign } from './items';
import { discover, isKnown } from './o_init';
import { heroEntity, useup } from './magic';

/**
 * ref: src/potion.c healup(): heals `nhp` and, if that goes past the maximum, raises the maximum
 * by `nxtra` and sets HP to it. Blindness cannot happen yet; sickness is handled by `cureSick`.
 */
export function healup(
  ctx: Ctx,
  nhp: number,
  nxtra: number,
  curesick: boolean,
  _cureblind: boolean,
): void {
  const hp = heroEntity(ctx).c.hp;
  if (!hp) return;
  if (nhp) {
    hp.cur += nhp;
    if (hp.cur > hp.max) {
      hp.max += nxtra;
      hp.cur = hp.max;
    }
  }
  if (curesick) cureSick(ctx);
}

/**
 * ref: src/potion.c make_sick(0L, (char *) 0, TRUE, SICK_ALL), make_vomiting(0L, TRUE): cures
 * food poisoning (the only illness we have; there is no vomiting countdown).
 */
export function cureSick(ctx: Ctx): void {
  makeSick(ctx, 0, '', true);
}

/** u.uhunger += n; newuhs(FALSE). ref: src/potion.c peffect_water() */
function addNutrition(ctx: Ctx, n: number): void {
  const h = heroEntity(ctx).c.hunger;
  if (!h) return;
  h.nutrition += n;
  newuhs(ctx, false);
}

const msg = (ctx: Ctx, key: string): void => ctx.emit({ type: 'msg', key });

/** Result flags of a potion effect: `unknown` = potion_unkn > 0 (the type is not revealed). */
interface Effect {
  unknown: boolean;
}

/** ref: src/potion.c peffect_healing() */
function peffectHealing(ctx: Ctx, p: Entity): Effect {
  const buc = p.c.item?.buc ?? 'uncursed';
  msg(ctx, 'potion.better');
  healup(
    ctx,
    8 + ctx.rng.d(4 + 2 * bcsign(buc), 4),
    buc !== 'cursed' ? 1 : 0,
    buc === 'blessed',
    buc !== 'cursed',
  );
  return { unknown: false };
}

/** ref: src/potion.c peffect_extra_healing() */
function peffectExtraHealing(ctx: Ctx, p: Entity): Effect {
  const buc = p.c.item?.buc ?? 'uncursed';
  msg(ctx, 'potion.much_better');
  healup(
    ctx,
    16 + ctx.rng.d(4 + 2 * bcsign(buc), 8),
    buc === 'blessed' ? 5 : buc !== 'cursed' ? 2 : 0,
    buc !== 'cursed',
    true,
  );
  return { unknown: false };
}

/**
 * ref: src/potion.c peffect_full_healing(). Not ported: restoring a lost level when blessed
 * (levels are never lost), wounded legs, hallucination.
 */
function peffectFullHealing(ctx: Ctx, p: Entity): Effect {
  const buc = p.c.item?.buc ?? 'uncursed';
  msg(ctx, 'potion.completely_healed');
  healup(ctx, 400, 4 + 4 * bcsign(buc), buc !== 'cursed', true);
  return { unknown: false };
}

/**
 * ref: src/potion.c peffect_see_invisible(). No invisibility or See_invisible status exists yet,
 * so the effect is only the taste message; the random draws are still made.
 */
function peffectSeeInvisible(ctx: Ctx, p: Entity): Effect {
  const buc = p.c.item?.buc ?? 'uncursed';
  msg(ctx, buc === 'cursed' ? 'potion.tastes_rotten' : 'potion.tastes_juice');
  // permchance = 10 (not invisible, no See_invisible yet)
  if (buc === 'blessed' && ctx.rng.rn2(10) === 0) {
    /* HSee_invisible |= FROMOUTSIDE: no status to set */
  } else ctx.rng.rn2(100); // rn1(100, 750): the timeout
  return { unknown: true };
}

/**
 * ref: src/potion.c peffect_water(). The hero is neutral and alive, so the chaotic and undead
 * branches do not apply: holy water is "full of awe", unholy "full of dread", plain water
 * feeds a little (and identifies the type).
 */
function peffectWater(ctx: Ctx, p: Entity): Effect {
  const buc = p.c.item?.buc ?? 'uncursed';
  if (buc === 'uncursed') {
    msg(ctx, 'potion.water_plain');
    addNutrition(ctx, ctx.rng.rnd(10));
    return { unknown: false };
  }
  if (buc === 'blessed') {
    msg(ctx, 'potion.water_holy');
    cureSick(ctx);
  } else if ((HERO_ALIGN_TYPE as number) === 1) {
    // lawful heroes are burned; unreachable while the hero is neutral
    msg(ctx, 'potion.water_burns');
    const hp = heroEntity(ctx).c.hp;
    if (hp) hp.cur -= ctx.rng.d(2, 6);
  } else msg(ctx, 'potion.water_unholy');
  return { unknown: true };
}

/** ref: src/potion.c peffects() for the potions in our subset. */
function peffects(ctx: Ctx, p: Entity): Effect {
  switch (p.def) {
    case 'nh:potion_of_healing':
      return peffectHealing(ctx, p);
    case 'nh:potion_of_extra_healing':
      return peffectExtraHealing(ctx, p);
    case 'nh:potion_of_full_healing':
      return peffectFullHealing(ctx, p);
    case 'nh:potion_of_see_invisible':
      return peffectSeeInvisible(ctx, p);
    case 'nh:potion_of_water':
      return peffectWater(ctx, p);
    default:
      return { unknown: true };
  }
}

/**
 * Drinks one potion of the stack: the effect, then discovery when the type was revealed, then
 * the potion is used up. ref: src/potion.c dopotion(). Not ported: the ghost in a milky potion
 * and the djinni in a smoky one, the score for identifying (more_experienced), and `trycall`
 * (naming an unidentified type).
 */
function dopotion(ctx: Ctx, _user: EntityId, itemId: EntityId): void {
  const p = ctx.state.entities[String(itemId)];
  if (!p?.c.item) return;
  const def = ctx.defs.object(p.def);
  const wasKnown = isKnown(ctx.state, ctx.defs, def);
  const eff = peffects(ctx, p);
  if (!wasKnown && !eff.unknown) discover(ctx, def);
  useup(ctx, itemId);
}

/** `use` for every potion in the subset (attached to the defs in index.ts). */
export const POTION_USES: Readonly<
  Record<string, (ctx: Ctx, user: EntityId, item: EntityId) => void>
> = {
  'nh:potion_of_healing': dopotion,
  'nh:potion_of_extra_healing': dopotion,
  'nh:potion_of_full_healing': dopotion,
  'nh:potion_of_see_invisible': dopotion,
  'nh:potion_of_water': dopotion,
};

const heroItem = (ctx: Ctx, id: unknown): Entity | null => {
  if (typeof id !== 'number') return null;
  const e = ctx.state.entities[String(id)];
  return e?.c.item?.carriedBy === ctx.state.playerId ? e : null;
};

function itemArg(action: PlayerAction): unknown {
  return action.type === 'mod' ? (action.args as { item?: unknown } | undefined)?.item : undefined;
}

export const QUAFF_ID: DefId = 'nh:quaff';

const quaff: ActionDef = {
  id: QUAFF_ID,
  labelKey: 'action.nh:quaff',
  handles: 'mod',
  offer(ctx, target): Offer[] {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    if (!e || ctx.defs.object(e.def).class !== 'potion') return [];
    return [
      {
        action: { type: 'mod', action: QUAFF_ID, args: { item: e.id } },
        labelKey: 'action.nh:quaff',
      },
    ];
  },
  // ref: src/potion.c dodrink() (no fountains or sinks yet)
  perform(ctx, action) {
    const e = heroItem(ctx, itemArg(action));
    if (!e) return 0;
    const def = ctx.defs.object(e.def);
    if (def.class !== 'potion' || !def.use) {
      ctx.emit({ type: 'msg', key: 'magic.silly_thing', params: { verb: { key: 'verb.drink' } } });
      return 0;
    }
    def.use(ctx, ctx.state.playerId, e.id);
    encumberMsg(ctx);
    return NORMAL_SPEED;
  },
};

export const POTION_ACTIONS: readonly ActionDef[] = [quaff];
