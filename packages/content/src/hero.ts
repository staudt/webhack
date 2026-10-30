// Hero stats for the stub Valkyrie: initial attributes/HP/kit, HP regeneration and experience.
import type { AttributesComponent, Ctx, EntityId, ModApi, MonsterDef } from '@nh/core';
import { giveStartingKit } from './kit';
import { adjabil } from './props';

/**
 * The stub hero is a human, female, neutral Valkyrie. ref: src/role.c roles[] Valkyrie allows
 * MH_HUMAN|MH_DWARF, ROLE_FEMALE, ROLE_LAWFUL|ROLE_NEUTRAL; human allows all alignments.
 * (Neutral humans are the common choice; alignment has no mechanical effect in M2.)
 */
export const HERO_RACE = 'human';

/** ref: include/attrib.h STR18 */
const STR18 = (x: number): number => 18 + x;

/** ref: src/role.c roles[] Valkyrie: Str Int Wis Dex Con Cha */
const VALK_ATTRBASE = [10, 7, 7, 7, 10, 7] as const;
const VALK_ATTRDIST = [30, 6, 7, 20, 30, 7] as const;
/** ref: src/role.c races[] human attrmin/attrmax */
const HUMAN_ATTRMIN = 3;
const HUMAN_ATTRMAX = [STR18(100), 18, 18, 18, 18, 18] as const;

/** ref: src/role.c struct RoleAdvance: infix, inrnd, lofix, lornd, hifix, hirnd */
interface HpAdvance {
  infix: number;
  inrnd: number;
  lofix: number;
  lornd: number;
  hifix: number;
  hirnd: number;
}
/** ref: src/role.c roles[] Valkyrie hpadv `{ 14, 0, 0, 8, 2, 0 }` */
const VALK_HPADV: HpAdvance = { infix: 14, inrnd: 0, lofix: 0, lornd: 8, hifix: 2, hirnd: 0 };
/** ref: src/role.c races[] human hpadv `{ 2, 0, 0, 2, 1, 0 }` */
const HUMAN_HPADV: HpAdvance = { infix: 2, inrnd: 0, lofix: 0, lornd: 2, hifix: 1, hirnd: 0 };
/** ref: src/role.c roles[] Valkyrie xlev (cutoff level between lo and hi hp advance) */
const VALK_XLEV = 10;
/** ref: include/global.h MAXULEV */
export const MAXULEV = 30;

/** ref: src/attrib.c rnd_attr() */
function rndAttr(ctx: Ctx): number {
  let x = ctx.rng.rn2(100);
  let i = 0;
  for (; i < VALK_ATTRDIST.length; i++) {
    x -= VALK_ATTRDIST[i] ?? 0;
    if (x < 0) break;
  }
  return i;
}

/** ref: src/attrib.c init_attr_role_redist() */
function redistribute(ctx: Ctx, a: number[], np: number, addition: boolean): number {
  const adj = addition ? 1 : -1;
  let tryct = 0;
  while ((addition ? np > 0 : np < 0) && tryct < 100) {
    const i = rndAttr(ctx);
    const v = a[i];
    if (v === undefined || (addition ? v >= (HUMAN_ATTRMAX[i] ?? 18) : v <= HUMAN_ATTRMIN)) {
      tryct++;
      continue;
    }
    tryct = 0;
    a[i] = v + adj;
    np -= adj;
  }
  return np;
}

/**
 * Initial attributes: role base values, then 75 total points distributed by attrdist, then the
 * 1-in-20 per-attribute variation. ref: src/attrib.c init_attr(), vary_init_attr();
 * src/u_init.c u_init_inventory_attrs() (init_attr(75)). Skipped: u_init_carry_attr_boost
 * (no inventory weight in M2); the AMAX peak value (we store only the current value).
 */
export function initialAttributes(ctx: Ctx): AttributesComponent {
  const a: number[] = [...VALK_ATTRBASE];
  let np = 75;
  for (const b of VALK_ATTRBASE) np -= b;
  np = redistribute(ctx, a, np, true);
  redistribute(ctx, a, np, false);
  // ref: src/attrib.c vary_init_attr()
  for (let i = 0; i < a.length; i++) {
    if (ctx.rng.rn2(20) === 0) {
      const xd = ctx.rng.rn2(7) - 2; // biased variation
      // ref: src/attrib.c adjattrib() (positive: clamp to max; negative: clamp to min)
      const next = (a[i] ?? 0) + xd;
      a[i] = Math.max(HUMAN_ATTRMIN, Math.min(HUMAN_ATTRMAX[i] ?? 18, next));
    }
  }
  const [str = 0, int = 0, wis = 0, dex = 0, con = 0, cha = 0] = a;
  return { str, int, wis, dex, con, cha };
}

/** ref: src/attrib.c newhp() Con adjustment */
function conPlus(con: number): number {
  if (con <= 3) return -2;
  if (con <= 6) return -1;
  if (con <= 14) return 0;
  if (con <= 16) return 1;
  if (con === 17) return 2;
  if (con === 18) return 3;
  return 4;
}

/**
 * Hit points gained: at level 0 (hero creation) the initial value, else the per-level gain.
 * ref: src/attrib.c newhp(). `ulevel` is the level before it is incremented.
 */
export function newhp(ctx: Ctx, ulevel: number, con: number, maxHp = 0): number {
  const role = VALK_HPADV;
  const race = HUMAN_HPADV;
  let hp: number;
  if (ulevel === 0) {
    hp = role.infix + race.infix;
    if (role.inrnd > 0) hp += ctx.rng.rnd(role.inrnd);
    if (race.inrnd > 0) hp += ctx.rng.rnd(race.inrnd);
    // no Con adjustment for initial hit points
  } else {
    if (ulevel < VALK_XLEV) {
      hp = role.lofix + race.lofix;
      if (role.lornd > 0) hp += ctx.rng.rnd(role.lornd);
      if (race.lornd > 0) hp += ctx.rng.rnd(race.lornd);
    } else {
      hp = role.hifix + race.hifix;
      if (role.hirnd > 0) hp += ctx.rng.rnd(role.hirnd);
      if (race.hirnd > 0) hp += ctx.rng.rnd(race.hirnd);
    }
    hp += conPlus(con);
  }
  if (hp <= 0) hp = 1;
  if (ulevel >= MAXULEV) {
    // after level 30, throttle gains; ref: src/attrib.c newhp()
    const lim = Math.max(5 - Math.trunc(maxHp / 300), 1);
    if (hp > lim) hp = lim;
  }
  return hp;
}

/** Experience points needed to leave level `lev`. ref: src/exper.c newuexp() */
export function newuexp(lev: number): number {
  if (lev < 1) return 0;
  if (lev < 10) return 10 * 2 ** lev;
  if (lev < 20) return 10000 * 2 ** (lev - 10);
  return 10000000 * (lev - 19);
}

const NORMAL_SPEED = 12;

/** ref: include/monattk.h AT_*; attacks after AT_BUTT (butt = 4) in numeric order are "special". */
const PLAIN_ATTACKS = new Set(['claw', 'bite', 'kick', 'butt']);

/** Damage types between AD_PHYS and AD_BLND exclusive. ref: include/monattk.h AD_MAGM..AD_SPC2 */
const ELEMENTAL_AD = new Set([
  'magm',
  'fire',
  'cold',
  'slee',
  'disn',
  'elec',
  'drst',
  'acid',
  'spc1',
  'spc2',
]);
const DEADLY_AD = new Set(['drli', 'ston', 'slim']);

/**
 * Experience points for killing a monster of `def` at level `monLevel`.
 * ref: src/exper.c experience(). Skipped (not in our data): the eel AD_WRAP bonus, the mail
 * daemon override, and the revived/cloned kill-count reduction. find_mac() uses the base AC
 * (monsters wear no armor in M2); "extra nasty" is the `nasty` flag (M2_NASTY).
 */
export function experienceFor(def: MonsterDef, monLevel: number): number {
  let tmp = 1 + monLevel * monLevel;
  const ac = def.ac;
  if (ac < 3) tmp += (7 - ac) * (ac < 0 ? 2 : 1);
  if (def.speed > NORMAL_SPEED) tmp += def.speed > (3 * NORMAL_SPEED) / 2 ? 5 : 3;
  for (const atk of def.attacks) {
    if (PLAIN_ATTACKS.has(atk.at)) continue;
    if (atk.at === 'weapon') tmp += 5;
    else if (atk.at === 'magic') tmp += 10;
    else tmp += 3;
  }
  for (const atk of def.attacks) {
    const ad = atk.ad.toLowerCase();
    if (ELEMENTAL_AD.has(ad)) tmp += 2 * monLevel;
    else if (DEADLY_AD.has(ad)) tmp += 50;
    else if (ad !== 'phys') tmp += monLevel;
    if (atk.d * atk.n > 23) tmp += monLevel;
  }
  if (def.flags.includes('nasty')) tmp += 7 * monLevel;
  if (monLevel > 8) tmp += 50;
  return tmp;
}

/**
 * Adds experience points and, if a threshold is crossed, gains ONE level. NetHack does the same:
 * pluslvl() caps points at newuexp(level+1)-1, so a huge award takes several kills to cash in.
 * ref: src/exper.c more_experienced(), newexplevel(), pluslvl()
 */
export function gainExperience(ctx: Ctx, heroId: EntityId, exp: number): void {
  const hero = ctx.state.entities[String(heroId)];
  const xp = hero?.c.experience;
  const hp = hero?.c.hp;
  if (!hero || !xp || !hp) return;
  xp.points += exp; // more_experienced()
  // newexplevel()
  if (xp.level < MAXULEV && xp.points >= newuexp(xp.level)) {
    // pluslvl(TRUE)
    const inc = newhp(ctx, xp.level, hero.c.attributes?.con ?? 10, hp.max);
    hp.cur += inc;
    hp.max += inc;
    if (hp.cur > hp.max) hp.cur = hp.max; // setuhpmax()
    const next = newuexp(xp.level + 1);
    if (xp.points >= next) xp.points = next - 1;
    xp.level += 1;
    ctx.emit({ type: 'msg', key: 'exp.welcome', params: { level: xp.level } });
    adjabil(ctx, heroId, xp.level - 1, xp.level); // ref: src/exper.c pluslvl()
  }
}

/**
 * Natural HP regeneration for a non-polymorphed, unencumbered hero without Regeneration:
 * each turn heals 1 with probability (level + Con)% (NetHack 5.0 rule).
 * ref: src/allmain.c regen_hp() (called from moveloop_core when u.uhp < u.uhpmax)
 */
function regenHp(ctx: Ctx): void {
  const { state } = ctx;
  if (state.gameOver !== null) return;
  const hero = state.entities[String(state.playerId)];
  const hp = hero?.c.hp;
  if (!hero || !hp || hp.cur < 1 || hp.cur >= hp.max) return;
  const level = hero.c.experience?.level ?? 1;
  const con = hero.c.attributes?.con ?? 10;
  const heal = level + con > ctx.rng.rn2(100) ? 1 : 0;
  if (heal) hp.cur = Math.min(hp.max, hp.cur + heal);
}

/** Registers the hero hooks through the public ModApi. */
export function registerHero(api: ModApi): void {
  // ref: src/u_init.c u_init() -- attributes first (init_attr), then HP (newhp at ulevel 0)
  api.on('newGame', (ctx, heroId) => {
    const hero = ctx.state.entities[String(heroId)];
    if (!hero) return;
    const attributes = initialAttributes(ctx);
    const max = newhp(ctx, 0, attributes.con);
    hero.c.attributes = attributes;
    hero.c.hp = { cur: max, max };
    hero.c.experience = { level: 1, points: 0 };
    // ref: src/u_init.c u_init(): ini_inv(Valkyrie) and skill_init(Skill_V) after attributes and HP
    giveStartingKit(ctx, heroId);
  });
  api.on('endOfTurn', regenHp);
}
