// Derived hero/monster numbers from carried items: AC, gold, encumbrance and movement.
import {
  NORMAL_SPEED,
  inventoryOf,
  type Ctx,
  type EntityId,
  type GameState,
  type ModApi,
  type Registry,
} from '@nh/core';
import { weight } from './items';
import { P } from './props';

/** ref: include/you.h AC_MAX */
const AC_MAX = 99;
/** The hero's base AC: the human race monster. ref: src/do_wear.c find_ac() mons[u.umonnum].ac */
const HUMAN_AC = 10;

const clampAc = (ac: number): number => Math.max(-AC_MAX, Math.min(AC_MAX, ac));

/**
 * Armor class of an entity from its worn armor. ref: src/do_wear.c find_ac() (hero) and
 * src/worn.c find_mac() (monsters). ARM_BONUS = armor ac bonus + spe (no erosion). Not ported:
 * rings of protection, amulet of guarding, divine protection, spell protection.
 */
export function findAc(state: Readonly<GameState>, defs: Registry, id: EntityId): number {
  const e = state.entities[String(id)];
  if (!e) return HUMAN_AC;
  let ac = defs.isMonster(e.def) ? defs.monster(e.def).ac : HUMAN_AC;
  for (const o of inventoryOf(state, id)) {
    const it = o.c.item;
    if (!it || it.equipped === null || it.equipped === 'weapon') continue;
    const armor = defs.object(o.def).armor;
    if (armor) ac -= armor.ac + it.spe;
  }
  return clampAc(ac);
}

/** ref: src/worn.c find_mac() */
export function findMac(state: Readonly<GameState>, defs: Registry, monsterId: EntityId): number {
  return findAc(state, defs, monsterId);
}

/** Gold the entity carries. ref: src/hack.c money_cnt() */
export function moneyCount(state: Readonly<GameState>, defs: Registry, id: EntityId): number {
  let n = 0;
  for (const o of inventoryOf(state, id)) {
    if (defs.object(o.def).class === 'coin') n += o.c.item?.quantity ?? 0;
  }
  return n;
}

/** ref: include/hack.h enum encumbrance_types */
export const UNENCUMBERED = 0;
export const OVERLOADED = 5;
export const ENCUMBRANCE_NAMES = [
  null,
  'burdened',
  'stressed',
  'strained',
  'overtaxed',
  'overloaded',
] as const;

/** ref: include/weight.h */
const WT_WEIGHTCAP_STRCON = 25;
const WT_WEIGHTCAP_SPARE = 50;
const MAX_CARR_CAP = 1000;

/** Strength as a 3..25 value: 18/xx and above are folded. ref: src/attrib.c acurrstr() */
export function acurrstr(str: number): number {
  if (str <= 18) return Math.max(str, 3);
  if (str <= 121) return 19 + Math.trunc(str / 50);
  return Math.min(str, 125) - 100;
}

/**
 * Carrying capacity. ref: src/hack.c weight_cap(). Not ported: polymorph, levitation, steeds,
 * wounded legs.
 */
export function weightCap(state: Readonly<GameState>, id: EntityId): number {
  const a = state.entities[String(id)]?.c.attributes;
  const carrcap =
    WT_WEIGHTCAP_STRCON * (acurrstr(a?.str ?? 10) + (a?.con ?? 10)) + WT_WEIGHTCAP_SPARE;
  return Math.max(Math.min(carrcap, MAX_CARR_CAP), 1);
}

/** Weight carried minus capacity (negative when below). ref: src/hack.c inv_weight() */
export function invWeight(state: Readonly<GameState>, defs: Registry, id: EntityId): number {
  let wt = 0;
  for (const o of inventoryOf(state, id)) {
    const it = o.c.item;
    if (!it) continue;
    // gold is (quan + 50) / 100 without weight()'s minimum of 1
    wt +=
      defs.object(o.def).class === 'coin' ? Math.trunc((it.quantity + 50) / 100) : weight(defs, o);
  }
  return wt - weightCap(state, id);
}

/**
 * 0 when unencumbered, else 1..5 (Burdened .. Overloaded). ref: src/hack.c calc_capacity() /
 * near_capacity(); `xtra` is extra weight about to be picked up.
 */
export function calcCapacity(
  state: Readonly<GameState>,
  defs: Registry,
  id: EntityId,
  xtra = 0,
): number {
  const wt = invWeight(state, defs, id) + xtra;
  if (wt <= 0) return UNENCUMBERED;
  const wc = weightCap(state, id);
  if (wc <= 1) return OVERLOADED;
  return Math.min(Math.trunc((wt * 2) / wc) + 1, OVERLOADED);
}

/** ref: src/hack.c near_capacity() */
export const nearCapacity = (state: Readonly<GameState>, defs: Registry, id: EntityId): number =>
  calcCapacity(state, defs, id, 0);

/**
 * Movement the hero gains per turn. ref: src/allmain.c u_calc_moveamt(): the base speed, a free
 * action on 2 turns in 3 when Very_fast (a timed Fast) or on 1 turn in 3 when intrinsically Fast
 * (the Valkyrie at experience level 7, ref: src/attrib.c val_abil { 7, HFast }), then reduced by
 * encumbrance.
 */
export function heroMovement(ctx: Ctx, hero: EntityId): number {
  const e = ctx.state.entities[String(hero)];
  let moveamt = e?.c.actor?.speed ?? 12;
  const fast = e?.c.props?.[P.FAST];
  if (fast && fast.timeout > 0) {
    // Very_fast: gain a free action on 2/3 of turns
    if (ctx.rng.rn2(3) !== 0) moveamt += NORMAL_SPEED;
  } else if (fast?.intrinsic) {
    // Fast (intrinsic): gain a free action on 1/3 of turns
    if (ctx.rng.rn2(3) === 0) moveamt += NORMAL_SPEED;
  }
  switch (nearCapacity(ctx.state, ctx.defs, hero)) {
    case 1:
      moveamt -= Math.trunc(moveamt / 4);
      break;
    case 2:
      moveamt -= Math.trunc(moveamt / 2);
      break;
    case 3:
      moveamt -= Math.trunc((moveamt * 3) / 4);
      break;
    case 4:
      moveamt -= Math.trunc((moveamt * 7) / 8);
      break;
    default:
      break;
  }
  return Math.max(moveamt, 0);
}

/** Registers the AC, gold and encumbrance status fields. ref: src/botl.c */
export function registerStats(api: ModApi): void {
  api.defineStatus({
    id: 'nh:ac',
    field: 'ac',
    value(state, defs) {
      const hero = state.entities[String(state.playerId)];
      if (!hero) return null;
      return findAc(state, defs, hero.id);
    },
  });
  api.defineStatus({
    id: 'nh:gold',
    field: 'gold',
    value: (state, defs) => moneyCount(state, defs, state.playerId),
  });
  api.defineStatus({
    id: 'nh:encumbrance',
    field: 'encumbrance',
    value(state, defs) {
      const hero = state.entities[String(state.playerId)];
      if (!hero?.c.attributes) return null;
      return ENCUMBRANCE_NAMES[nearCapacity(state, defs, hero.id)] ?? null;
    },
  });
}
