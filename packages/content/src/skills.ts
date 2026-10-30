// Weapon skills. ref: src/weapon.c skill_init(), weapon_hit_bonus(), weapon_dam_bonus();
// src/u_init.c Skill_V
import { type Ctx, type ObjectDef, inventoryOf } from '@nh/core';
import { nhData } from './items';

/** ref: include/skills.h P_ISRESTRICTED..P_GRAND_MASTER */
export const P_RESTRICTED = 0;
export const P_UNSKILLED = 1;
export const P_BASIC = 2;
export const P_SKILLED = 3;
export const P_EXPERT = 4;

/** The pseudo-skill for fighting without a weapon. ref: include/skills.h P_BARE_HANDED_COMBAT */
export const BARE_HANDED = 'bare_handed';

/**
 * The Valkyrie's skill maximums. ref: src/u_init.c Skill_V[]. Skills not listed are restricted.
 * The spell, riding and two-weapon entries are kept for completeness; nothing uses them yet.
 */
export const SKILL_V: Readonly<Record<string, number>> = {
  dagger: P_EXPERT,
  axe: P_EXPERT,
  pick_axe: P_SKILLED,
  short_sword: P_SKILLED,
  broad_sword: P_SKILLED,
  long_sword: P_EXPERT,
  two_handed_sword: P_EXPERT,
  saber: P_BASIC,
  hammer: P_EXPERT,
  quarterstaff: P_BASIC,
  polearms: P_SKILLED,
  spear: P_EXPERT,
  trident: P_BASIC,
  lance: P_SKILLED,
  sling: P_BASIC,
  attack_spell: P_BASIC,
  escape_spell: P_BASIC,
  riding: P_SKILLED,
  two_weapon: P_SKILLED,
  [BARE_HANDED]: P_EXPERT,
};

/**
 * Sets the hero's starting skills: every skill is restricted, weapons in the inventory are
 * Basic, then the role's skills not already set become Unskilled. ref: src/weapon.c skill_init().
 * Skipped: the ammo exception (no ammo yet), magic skills, riding, advancement counters,
 * training and #enhance (skills never improve).
 */
export function skillInit(ctx: Pick<Ctx, 'state' | 'defs'>, heroId: number): void {
  const skills: Record<string, number> = {};
  for (const o of inventoryOf(ctx.state, heroId)) {
    const w = ctx.defs.object(o.def).weapon;
    if (w) skills[w.skill] = P_BASIC;
  }
  for (const name of Object.keys(SKILL_V).sort()) {
    if (skills[name] === undefined) skills[name] = P_UNSKILLED;
  }
  // "High potential fighters already know how to use their hands": only when max > Expert.
  nhData(ctx).skills = skills;
}

/** The hero's current level in a skill (restricted = 0 when absent). */
export function skillLevel(ctx: Pick<Ctx, 'state'>, skill: string): number {
  return nhData(ctx).skills?.[skill] ?? P_RESTRICTED;
}

/**
 * To-hit modifier for fighting with `weapon` (null = bare hands). ref: src/weapon.c
 * weapon_hit_bonus(). Restricted counts as Unskilled. Not a weapon: 0. Two-weapon combat and
 * riding are not implemented.
 */
export function weaponHitBonus(level: number, weapon: ObjectDef | null): number {
  if (weapon === null) {
    // bare-handed: ((max(skill, unskilled) - 1) + 2) / 2 (no martial arts)
    return Math.trunc((Math.max(level, P_UNSKILLED) - 1 + 2) / 2);
  }
  if (!weapon.weapon) return 0; // weapon_type() == P_NONE
  switch (level) {
    case P_BASIC:
      return 0;
    case P_SKILLED:
      return 2;
    case P_EXPERT:
      return 3;
    default:
      return -4; // restricted or unskilled
  }
}

/** Damage modifier for fighting with `weapon` (null = bare hands). ref: src/weapon.c weapon_dam_bonus() */
export function weaponDamBonus(level: number, weapon: ObjectDef | null): number {
  if (weapon === null) return Math.trunc((Math.max(level, P_UNSKILLED) - 1 + 1) / 2);
  if (!weapon.weapon) return 0;
  switch (level) {
    case P_BASIC:
      return 0;
    case P_SKILLED:
      return 1;
    case P_EXPERT:
      return 2;
    default:
      return -2;
  }
}
