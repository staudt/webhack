// Melee combat: the hero attacking monsters and monsters attacking the hero.
import {
  NORMAL_SPEED,
  getPlayer,
  sortedIds,
  type AttackType,
  type Ctx,
  type Dice,
  type EntityId,
  type GearComponent,
  type MonsterDef,
  type Pos,
  type Rng,
} from '@nh/core';
import { experienceFor, gainExperience } from './hero';

type Weapon = GearComponent['weapon'];

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

/** ref: src/weapon.c hitval(): enchantment plus the spear bonus (no oc_hitbon in our data). */
function hitval(weapon: NonNullable<Weapon>, def: MonsterDef): number {
  let tmp = weapon.enchant;
  if (weapon.nameKey === 'weapon.spear' && KEBABABLE.includes(def.glyph.ch)) tmp += 2;
  return tmp;
}

export interface HeroCombatStats {
  str: number;
  dex: number;
  level: number;
}

/**
 * The hero's to-hit number: a hit needs `tmp > rnd(20)`.
 * ref: src/uhitm.c find_roll_to_hit(). Luck is 0, no rings (u.uhitinc), not trapped, not
 * encumbered, not stunned/frozen. The defender's AC is its base AC (find_mac, no armor).
 * Bare-handed uses the weapon_hit_bonus() Basic bare-handed value, +1.
 */
export function heroToHit(
  hero: HeroCombatStats,
  def: MonsterDef,
  target: { asleep: boolean },
  weapon: Weapon,
): number {
  let tmp = 1 + abon(hero.str, hero.dex, hero.level) + def.ac + hero.level;
  if (target.asleep) tmp += 2; // msleeping
  if (weapon) tmp += hitval(weapon, def) + weapon.skillBonus;
  else tmp += 1; // ref: src/weapon.c weapon_hit_bonus() P_BARE_HANDED_COMBAT basic
  return tmp;
}

/** ref: src/weapon.c dmgval(): weapon dice by target size plus enchantment; no other bonuses. */
export function dmgval(rng: Rng, weapon: NonNullable<Weapon>, def: MonsterDef): number {
  const dice: Dice = isBig(def) ? weapon.large : weapon.small;
  let tmp = rng.d(dice[0], dice[1]);
  tmp += weapon.enchant;
  // negative enchantment mustn't produce negative damage
  if (tmp < 0) tmp = 0;
  // erosion: if (tmp > 0) tmp -= greatest_erosion, floor 1 -- no erosion in M2, so unchanged
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
 * Not ported: peaceful confirmation, knockback, passive attacks, two-weapon, skill training.
 */
export function heroAttack(ctx: Ctx, targetId: EntityId): number {
  const hero = getPlayer(ctx.state);
  const target = ctx.state.entities[String(targetId)];
  const mon = target?.c.monster;
  if (!target || !mon) throw new Error(`Entity ${targetId} is not a monster`);
  const def = ctx.defs.monster(target.def);
  const name = `@${target.def}`;
  const attrs = hero.c.attributes;
  const weapon = hero.c.gear?.weapon ?? null;
  const stats: HeroCombatStats = {
    str: attrs?.str ?? 10,
    dex: attrs?.dex ?? 10,
    level: hero.c.experience?.level ?? 1,
  };

  // ref: src/uhitm.c hitum()
  const tmp = heroToHit(stats, def, mon, weapon);
  const dieroll = ctx.rng.rnd(20);
  if (!(tmp > dieroll)) {
    // ref: src/uhitm.c missum(): "You miss <mon>." then wakeup(mdef, TRUE)
    ctx.emit({ type: 'msg', key: 'combat.you_miss', params: { mon: name } });
    wakeup(mon);
    return NORMAL_SPEED;
  }

  // ref: src/uhitm.c hmon_hitmon(): dmgval, then dbon only if dmgval > 0, minimum 1
  let dmg = weapon ? dmgval(ctx.rng, weapon, def) : ctx.rng.rnd(2); // barehanded rnd(2)
  if (dmg > 0) dmg += dbon(stats.str); // weapon_dam_bonus is 0 at Basic skill
  if (dmg < 1) dmg = 1;

  const hp = target.c.hp;
  if (hp) hp.cur -= dmg;
  if (!hp || hp.cur < 1) {
    // ref: src/mon.c xkilled(): "You kill/destroy <mon>!" then experience()
    ctx.emit({
      type: 'msg',
      key: nonliving(def) ? 'combat.you_destroy' : 'combat.you_kill',
      params: { mon: name },
    });
    ctx.remove(targetId);
    gainExperience(ctx, hero.id, experienceFor(def, mon.level));
    return NORMAL_SPEED;
  }
  // ref: src/uhitm.c hmon_hitmon_msg_hit(): "You hit <mon>" + exclam(dmg)
  ctx.emit({
    type: 'msg',
    key: exclam(dmg) === '!' ? 'combat.you_hit_hard' : 'combat.you_hit',
    params: { mon: name },
  });
  wakeup(mon);
  return NORMAL_SPEED;
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
export function monsterToHit(rng: Rng, heroAc: number, monLevel: number): number {
  let tmp = acValue(rng, heroAc) + 10;
  tmp += monLevel;
  if (tmp <= 0) tmp = 1;
  return tmp;
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
  const ac = hero.c.gear?.ac ?? 10;
  const tmp = monsterToHit(ctx.rng, ac, m.level);

  let prevHit = -1; // index of the previous attack if it hit (ref: hitmsg_prev)
  for (let i = 0; i < def.attacks.length; i++) {
    const atk = def.attacks[i];
    if (!atk || !MELEE_AT.has(atk.at)) continue; // other attack types: M3+
    const j = ctx.rng.rnd(20 + i);
    if (!(tmp > j)) {
      // ref: src/mhitu.c missmu(): "just misses" when the roll equals tmp exactly (verbose)
      ctx.emit({
        type: 'msg',
        key: tmp === j ? 'combat.mon_just_misses' : 'combat.mon_misses',
        params: { mon: name },
      });
      prevHit = -1;
      continue;
    }
    // ref: src/mhitu.c hitmu(): base damage d(damn, damd), then hitmsg()
    let dmg = ctx.rng.d(atk.n, atk.d);
    const again = prevHit === i - 1 && def.attacks[i - 1]?.at === atk.at;
    ctx.emit({
      type: 'msg',
      key: `combat.mon_${hitVerb(atk.at)}${again ? '_again' : ''}`,
      params: { mon: name },
    });
    prevHit = i;
    // Negative armor class reduces damage done instead of fully protecting against hits.
    if (dmg > 0 && ac < 0) {
      dmg -= ctx.rng.rnd(-ac);
      if (dmg < 1) dmg = 1;
    }
    hp.cur -= dmg;
    ctx.interrupt(); // ref: stop_occupation() / nomul(0)
    if (hp.cur < 1) {
      // ref: src/mhitu.c mdamageu() -> src/end.c done_in_by(): "You die..."
      ctx.emit({ type: 'msg', key: 'combat.you_die' });
      ctx.endGame({
        kind: 'died',
        killer: `@${mon.def}`,
        turn: ctx.state.turn,
        depth: ctx.state.levels[ctx.state.currentLevel]?.depth ?? 1,
        level: hero.c.experience?.level ?? 1,
      });
      return;
    }
  }
}
