// Melee combat: the hero attacking monsters and monsters attacking the hero.
import {
  NORMAL_SPEED,
  getPlayer,
  sortedIds,
  type AttackType,
  type Ctx,
  type EntityId,
  type Entity,
  type ObjectDef,
  inventoryOf,
  type MonsterDef,
  type Pos,
  type Rng,
} from '@nh/core';
import { hitmuAd, mdamageu } from './mhitu';
import { monsterDied } from './mondeath';
import { passive, type PassiveTarget } from './uhitm_passive';
import { xnameOf } from './objnam';
import { stopOccupation } from './eat';
import { experienceFor, gainExperience } from './hero';
import { gethungry } from './hunger';
import { weight } from './items';
import { heroSees, monWep, monWieldItem } from './mongear';
import { findAc, findMac, nearCapacity } from './stats';
import { P_UNSKILLED, BARE_HANDED, skillLevel, weaponDamBonus, weaponHitBonus } from './skills';

/** ref: include/attrib.h STR18 */
const STR18 = (x: number): number => 18 + x;

/** ref: src/weapon.c abon(): to-hit bonus from Str and Dex (never polymorphed). */
export function abon(str: number, dex: number, level: number): number {
  let sbon: number;
  if (str < 6) sbon = -2;
  else if (str < 8) sbon = -1;
  else if (str < 17) sbon = 0;
  else if (str < STR18(50)) sbon = 1;
  else if (str < STR18(100)) sbon = 2;
  else sbon = 3;
  // Game tuning kludge: make it a bit easier for a low level character to hit
  sbon += level < 3 ? 1 : 0;
  if (dex < 4) return sbon - 3;
  if (dex < 6) return sbon - 2;
  if (dex < 8) return sbon - 1;
  if (dex < 14) return sbon;
  return sbon + dex - 14;
}

/** ref: src/weapon.c dbon(): damage bonus from Str. */
export function dbon(str: number): number {
  if (str < 6) return -1;
  if (str < 16) return 0;
  if (str < 18) return 1;
  if (str === 18) return 2;
  if (str <= STR18(75)) return 3;
  if (str <= STR18(90)) return 4;
  if (str < STR18(100)) return 5;
  return 6;
}

/** ref: include/hack.h AC_VALUE(): a negative AC is randomized to -rnd(-AC). */
export function acValue(rng: Rng, ac: number): number {
  return ac >= 0 ? ac : -rng.rnd(-ac);
}

/** ref: include/mondata.h bigmonst(): MZ_LARGE and bigger. */
export function isBig(def: MonsterDef): boolean {
  return def.size === 'large' || def.size === 'huge' || def.size === 'gigantic';
}

/** ref: src/weapon.c kebabable[]: S_XORN, S_DRAGON, S_JABBERWOCK, S_NAGA, S_GIANT (by glyph letter). */
const KEBABABLE = 'XDJNH';

/**
 * ref: src/weapon.c hitval(): enchantment (weapons only), the object's own to-hit bonus and the
 * spear bonus against kebabable monsters. Not ported: blessed vs undead/demons, trident vs
 * swimmers, picks vs xorns, artifacts.
 */
export function hitval(item: Entity, def: ObjectDef, mon: MonsterDef | null): number {
  let tmp = 0;
  const w = def.weapon;
  if (w) tmp += item.c.item?.spe ?? 0;
  tmp += w?.hitBonus ?? 0;
  if (w?.skill === 'spear' && mon && KEBABABLE.includes(mon.glyph.ch)) tmp += 2;
  return tmp;
}

/** The hero's wielded object, its def and her level in its skill; null = bare hands. */
export interface HeroWeapon {
  item: Entity;
  def: ObjectDef;
  /** Skill level (see skills.ts) for the weapon's skill; unused for non-weapons. */
  skill: number;
}

export interface HeroCombatStats {
  str: number;
  dex: number;
  level: number;
  /** near_capacity(): 0..5 */
  encumbrance?: number;
  /** Level in bare-handed combat; defaults to Unskilled. */
  bareSkill?: number;
}

/**
 * The hero's to-hit number: a hit needs `tmp > rnd(20)`.
 * ref: src/uhitm.c find_roll_to_hit(). Luck is 0, no rings (u.uhitinc), not trapped, not
 * stunned/frozen/fleeing. `def.ac` should be the defender's find_mac(); pass `mac` to override
 * (monsters wearing armor). Encumbrance subtracts (2 * level - 1).
 */
export function heroToHit(
  hero: HeroCombatStats,
  def: MonsterDef,
  target: { asleep: boolean },
  weapon: HeroWeapon | null,
  mac: number = def.ac,
): number {
  let tmp = 1 + abon(hero.str, hero.dex, hero.level) + mac + hero.level;
  if (target.asleep) tmp += 2; // msleeping
  const enc = hero.encumbrance ?? 0;
  if (enc !== 0) tmp -= enc * 2 - 1;
  if (weapon) {
    tmp += hitval(weapon.item, weapon.def, def);
    tmp += weaponHitBonus(weapon.skill, weapon.def);
  } else tmp += weaponHitBonus(hero.bareSkill ?? P_UNSKILLED, null);
  return tmp;
}

/**
 * Extra damage some weapons do beyond their die: [small, large] dice or constants.
 * ref: src/weapon.c dmgval() switch (otyp), for the weapons in our subset.
 */
function dmgvalExtra(rng: Rng, id: string, big: boolean): number {
  switch (id) {
    case 'nh:mace': // d6+1 vs small
      return big ? 0 : 1;
    case 'nh:dwarvish_mattock': // d12 + 2d6 vs large
      return big ? rng.d(2, 6) : 0;
    default:
      return 0;
  }
}

/**
 * ref: src/weapon.c dmgval(): the weapon die by target size, the per-type extra, plus
 * enchantment, never below 0. Not ported: erosion, silver/blessed bonuses, artifacts.
 */
export function dmgval(rng: Rng, item: Entity, def: ObjectDef, mon: MonsterDef): number {
  return dmgvalSized(rng, item, def, isBig(mon));
}

/** dmgval() against a target whose size class is already known (the hero is not big). */
export function dmgvalSized(rng: Rng, item: Entity, def: ObjectDef, big: boolean): number {
  const w = def.weapon;
  let tmp = 0;
  if (w) {
    const dice = big ? w.large : w.small;
    // rnd(oc_wsdam) / rnd(oc_wldam): the data stores them as [1, sides]
    tmp = rng.d(dice[0], dice[1]);
    tmp += dmgvalExtra(rng, def.id, big);
    tmp += item.c.item?.spe ?? 0;
    if (tmp < 0) tmp = 0;
  }
  return tmp;
}

/** ref: src/zap.c exclam() */
const exclam = (force: number): string => (force < 0 ? '?' : force <= 4 ? '.' : '!');

const monsterAt = (ctx: Ctx, pos: Pos, level: string): EntityId | null => {
  for (const id of sortedIds(ctx.state)) {
    const e = ctx.state.entities[String(id)];
    const p = e?.c.pos;
    if (e?.c.monster && p && p.level === level && p.x === pos.x && p.y === pos.y) return id;
  }
  return null;
};

/** The monster entity at `pos` on `level`, if any (attacks do not need to see it). */
export const monsterIdAt = monsterAt;

/** ref: include/mondata.h nonliving(): undead and manes (our data has no other cases). */
function nonliving(def: MonsterDef): boolean {
  return def.flags.includes('undead') || def.id === 'nh:manes';
}

/**
 * The hero attacks the monster entity `targetId`; returns the energy cost.
 * ref: src/hack.c domove() -> src/uhitm.c do_attack() -> hitum() -> known_hitum() -> hmon().
 * The monster's passive attack answers each blow (ref: hitum() -> passive()). Not ported:
 * peaceful confirmation, knockback, two-weapon, skill training.
 */
export function heroAttack(ctx: Ctx, targetId: EntityId): number {
  const hero = getPlayer(ctx.state);
  const target = ctx.state.entities[String(targetId)];
  const mon = target?.c.monster;
  if (!target || !mon) throw new Error(`Entity ${targetId} is not a monster`);
  const def = ctx.defs.monster(target.def);
  const name = `@${target.def}`;
  const snap: PassiveTarget | null = target.c.pos
    ? { id: targetId, def, level: mon.level, pos: { ...target.c.pos } }
    : null;
  /** ref: src/uhitm.c hitum(): passive(mon, uwep, mhit, malive, AT_WEAP, ...) */
  const answer = (mhit: boolean, malive: boolean): number => {
    if (snap) passive(ctx, snap, mhit, malive);
    return NORMAL_SPEED;
  };
  const attrs = hero.c.attributes;
  const wielded = inventoryOf(ctx.state, hero.id).find((o) => o.c.item?.equipped === 'weapon');
  const wdef = wielded ? ctx.defs.object(wielded.def) : null;
  const weapon: HeroWeapon | null =
    wielded && wdef
      ? { item: wielded, def: wdef, skill: skillLevel(ctx, wdef.weapon?.skill ?? '') }
      : null;
  // ref: src/uhitm.c do_attack() -> src/hack.c overexertion(): combat increases metabolism, and
  // the hero may faint from it, which cancels the attack. (The HVY_ENCUMBER HP loss is not ported.)
  gethungry(ctx);
  if (hero.c.helpless || ctx.state.gameOver) return NORMAL_SPEED;
  const stats: HeroCombatStats = {
    str: attrs?.str ?? 10,
    dex: attrs?.dex ?? 10,
    level: hero.c.experience?.level ?? 1,
    encumbrance: nearCapacity(ctx.state, ctx.defs, hero.id),
    bareSkill: skillLevel(ctx, BARE_HANDED),
  };

  // ref: src/uhitm.c hitum()
  const tmp = heroToHit(stats, def, mon, weapon, findMac(ctx.state, ctx.defs, targetId));
  const dieroll = ctx.rng.rnd(20);
  if (!(tmp > dieroll)) {
    // ref: src/uhitm.c missum(): "You miss <mon>." then wakeup(mdef, TRUE)
    ctx.emit({ type: 'msg', key: 'combat.you_miss', params: { mon: name } });
    wakeup(mon);
    return answer(false, true);
  }

  // ref: src/uhitm.c hmon_hitmon(): the base damage, then (if above 0) the Str bonus (3/2 of
  // it for a two-handed melee weapon) and the weapon-skill bonus, and a minimum of 1.
  let dmg: number;
  let useSkill = false;
  let strBonus = true;
  if (!weapon) {
    // hmon_hitmon_barehands: rnd(2) (rnd(4) for martial arts, which we lack)
    dmg = ctx.rng.rnd(2);
    useSkill = true;
  } else if (weapon.def.weapon) {
    dmg = dmgval(ctx.rng, weapon.item, weapon.def, def);
    useSkill = true;
  } else if (weapon.def.material === 'veggy' || weapon.def.material === 'paper') {
    // hmon_hitmon_misc_obj default: vegetables and paper do no damage
    dmg = 0;
    strBonus = false;
  } else {
    // non-weapons damage by weight, at most 6
    const owt = weight(ctx.defs, weapon.item);
    dmg = Math.trunc((owt + 99) / 100);
    dmg = dmg <= 1 ? 1 : ctx.rng.rnd(dmg);
    if (dmg > 6) dmg = 6;
  }
  if (dmg > 0) {
    if (strBonus) {
      let sb = dbon(stats.str);
      if (weapon?.def.weapon?.bimanual) {
        sb = Math.trunc((3 * Math.abs(sb) + 1) / 2) * Math.sign(sb);
      }
      dmg += sb;
    }
    if (useSkill) {
      dmg += weaponDamBonus(
        weapon ? weapon.skill : (stats.bareSkill ?? P_UNSKILLED),
        weapon?.def ?? null,
      );
    }
    if (dmg < 1) dmg = 1;
  } else if (strBonus) dmg = 1;
  else dmg = 0;

  const hp = target.c.hp;
  if (hp) hp.cur -= dmg;
  if (!hp || hp.cur < 1) {
    // ref: src/mon.c xkilled(): "You kill/destroy <mon>!" then experience()
    ctx.emit({
      type: 'msg',
      key: nonliving(def) ? 'combat.you_destroy' : 'combat.you_kill',
      params: { mon: name },
    });
    monsterDied(ctx, targetId, true);
    gainExperience(ctx, hero.id, experienceFor(def, mon.level));
    return answer(true, false);
  }
  // ref: src/uhitm.c hmon_hitmon_msg_hit(): "You hit <mon>" + exclam(dmg)
  ctx.emit({
    type: 'msg',
    key: exclam(dmg) === '!' ? 'combat.you_hit_hard' : 'combat.you_hit',
    params: { mon: name },
  });
  wakeup(mon);
  return answer(true, true);
}

/** ref: src/mon.c wakeup(mtmp, TRUE): wakes the monster and (setmangry) makes it hostile. */
function wakeup(mon: { asleep: boolean; peaceful: boolean }): void {
  mon.asleep = false;
  mon.peaceful = false;
}

/**
 * Monster to-hit: `tmp > rnd(20 + i)` for attack index i.
 * ref: src/mhitu.c mattacku(): tmp = AC_VALUE(u.uac) + 10; tmp += m_lev; if (tmp <= 0) tmp = 1.
 * (Hero not helpless, not invisible, monster can see and is not trapped.)
 */
export function monsterToHit(
  rng: Rng,
  heroAc: number,
  monLevel: number,
  heroHelpless = false,
): number {
  let tmp = acValue(rng, heroAc) + 10;
  tmp += monLevel;
  if (heroHelpless) tmp += 4; // multi < 0
  if (tmp <= 0) tmp = 1;
  return tmp;
}

/**
 * "The dwarf swings its mattock." ref: src/mhitu.c mswings(), mswings_verb(): pierce-only
 * weapons thrust (dual-purpose ones would randomize), the rest swing. No gender, so "its".
 */
function mswings(ctx: Ctx, mon: Entity, weapon: Entity): void {
  const wdef = ctx.defs.object(weapon.def);
  const one = (weapon.c.item?.quantity ?? 1) > 1 ? '_one_of' : '';
  ctx.emit({
    type: 'msg',
    key: `mon.${wdef.weapon?.kind === 'pierce' ? 'thrusts' : 'swings'}${one}`,
    params: { mon: `@${mon.def}`, weapon: xnameOf(ctx.state, ctx.defs, weapon) },
  });
}

/** ref: src/mhitu.c hitmsg(): the verb by attack type. */
function hitVerb(at: AttackType): string {
  switch (at) {
    case 'bite':
      return 'bites';
    case 'kick':
      return 'kicks';
    case 'sting':
      return 'stings';
    case 'butt':
      return 'butts';
    case 'touch':
      return 'touches';
    default:
      return 'hits';
  }
}

/** Attack types mattacku() resolves as a to-hit roll against the hero in melee. */
const MELEE_AT = new Set<AttackType>([
  'claw',
  'kick',
  'bite',
  'sting',
  'touch',
  'butt',
  'tentacle',
  'weapon',
]);

/**
 * The monster `monId` makes all its melee attacks at the hero (it is adjacent).
 * ref: src/mhitu.c mattacku(), hitmu(), hitmsg(), missmu(), mdamageu(); src/end.c done_in_by().
 */
export function monsterAttack(ctx: Ctx, monId: EntityId): void {
  const hero = getPlayer(ctx.state);
  const mon = ctx.state.entities[String(monId)];
  const m = mon?.c.monster;
  const hp = hero.c.hp;
  if (!mon || !m || !hp) throw new Error(`Entity ${monId} cannot attack`);
  const def = ctx.defs.monster(mon.def);
  const name = `@${mon.def}`;
  const ac = findAc(ctx.state, ctx.defs, hero.id);
  const tmp = monsterToHit(ctx.rng, ac, m.level, hero.c.helpless !== undefined);

  let prevHit = -1; // index of the previous attack if it hit (ref: hitmsg_prev)
  for (let i = 0; i < def.attacks.length; i++) {
    const atk = def.attacks[i];
    if (!atk || !MELEE_AT.has(atk.at)) continue; // other attack types: M3+
    // ref: src/mhitu.c mattacku() AT_WEAP: wield a weapon first if one is wanted (the move is
    // spent), then add the weapon's to-hit and announce the swing before rolling
    let attackTmp = tmp;
    let mwep: Entity | null = null;
    if (atk.at === 'weapon') {
      if (monWieldItem(ctx, monId)) continue;
      mwep = monWep(ctx, monId);
      if (mwep) {
        attackTmp += hitval(mwep, ctx.defs.object(mwep.def), null);
        if (mon.c.pos && heroSees(ctx, mon.c.pos)) mswings(ctx, mon, mwep);
      }
    }
    const j = ctx.rng.rnd(20 + i);
    if (!(attackTmp > j)) {
      // ref: src/mhitu.c missmu(): "just misses" when the roll equals tmp exactly (verbose)
      ctx.emit({
        type: 'msg',
        key: attackTmp === j ? 'combat.mon_just_misses' : 'combat.mon_misses',
        params: { mon: name },
      });
      prevHit = -1;
      continue;
    }
    // ref: src/mhitu.c hitmu(): base damage d(damn, damd), then hitmsg()
    let dmg = ctx.rng.d(atk.n, atk.d);
    if (atk.at === 'weapon' && mwep && atk.ad === 'phys') {
      // ref: src/uhitm.c mhitm_ad_phys() "hand to hand weapon": damage += dmgval(otmp, hero)
      dmg += dmgvalSized(ctx.rng, mwep, ctx.defs.object(mwep.def), false);
      if (dmg <= 0) dmg = 1;
    }
    const again = prevHit === i - 1 && def.attacks[i - 1]?.at === atk.at;
    ctx.emit({
      type: 'msg',
      key: `combat.mon_${hitVerb(atk.at)}${again ? '_again' : ''}`,
      params: { mon: name },
    });
    prevHit = i;
    // ref: src/uhitm.c mhitm_adtyping(): the damage type's effect (resistances, sleep, poison, ...)
    dmg = hitmuAd(ctx, mon, atk, dmg);
    if (ctx.state.gameOver) {
      stopOccupation(ctx);
      return;
    }
    // Negative armor class reduces damage done instead of fully protecting against hits.
    if (dmg > 0 && ac < 0) {
      dmg -= ctx.rng.rnd(-ac);
      if (dmg < 1) dmg = 1;
    }
    if (dmg > 0) mdamageu(ctx, dmg, name); // ref: src/mhitu.c mdamageu() -> done_in_by()
    stopOccupation(ctx); // ref: stop_occupation() / nomul(0)
    if (ctx.state.gameOver) return;
  }
}
