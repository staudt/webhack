// Monsters throwing and shooting missiles at the hero, and the helpers shared with the hero's own
// throwing (ammo, launchers, breaking).
// ref: src/mthrowu.c thitu(), drop_throw(), monmulti(), monshoot(), ohitmon(), m_throw(), thrwmu(),
// linedup(); src/weapon.c select_rwep(); src/dothrow.c should_mulch_missile(), omon_adj()
import {
  getPlayer,
  inBounds,
  isVisible,
  shownId,
  type Ctx,
  type DefId,
  type Entity,
  type EntityId,
  type MonsterDef,
  type Msg,
  type ObjectDef,
  type Pos,
  type PosComponent,
} from '@nh/core';
import { dmgvalSized, hitval, isBig, monsterIdAt } from './combat';
import { stopOccupation } from './eat';
import { mdamageu } from './mhitu';
import { addToInventory, placeOnFloor, removeFromInventory, splitStack } from './items';
import { heroSees, minvent, monFlag, monWep, monWield } from './mongear';
import { monsterDied } from './mondeath';
import { xnameOf } from './objnam';
import { findAc, findMac } from './stats';

/** ref: include/hack.h BOLT_LIM */
const BOLT_LIM = 8;

const say = (ctx: Ctx, key: string, params?: Record<string, Msg | string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

const distmin = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ---------------------------------------------------------------------------------------------
// classifying objects

/** ref: include/obj.h is_launcher() */
export const isLauncher = (def: ObjectDef): boolean => def.weapon?.role === 'launcher';
/** ref: include/obj.h is_ammo(): arrows, bolts and sling stones */
export const isAmmo = (def: ObjectDef): boolean => def.weapon?.role === 'ammo';
/** ref: include/obj.h is_missile(): darts */
export const isMissile = (def: ObjectDef): boolean => def.weapon?.role === 'missile';
/** ref: include/obj.h matching_launcher(): the launcher shoots ammo of its own skill */
export const matchingLauncher = (ammo: ObjectDef, launcher: ObjectDef | null): boolean =>
  launcher !== null &&
  isLauncher(launcher) &&
  ammo.weapon !== undefined &&
  launcher.weapon?.skill === ammo.weapon.skill;
/** ref: include/obj.h ammo_and_launcher() */
export const ammoAndLauncher = (ammo: ObjectDef, launcher: ObjectDef | null): boolean =>
  isAmmo(ammo) && matchingLauncher(ammo, launcher);

/** ref: include/mondata.h MZ_TINY 0 .. MZ_HUGE 4, MZ_GIGANTIC 7 */
const SIZE: Record<MonsterDef['size'], number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gigantic: 7,
};
const MZ_MEDIUM = 2;

/**
 * ref: src/dothrow.c omon_adj(): size, sleeping, immobility and the object's own hit bonus.
 * (`mon_notices`, which may wake a frozen target, is not ported: no monster is ever frozen.)
 */
export function omonAdj(mon: Entity, mdef: MonsterDef, obj: Entity, odef: ObjectDef): number {
  let tmp = SIZE[mdef.size] - MZ_MEDIUM; // -2..+5
  if (mon.c.monster?.asleep) tmp += 2;
  if (mdef.speed === 0) tmp += 4; // immobile
  if (odef.class === 'weapon' || odef.class === 'gem') tmp += hitval(obj, odef, mdef);
  return tmp;
}

/**
 * Whether a missile that hit (or was fired) breaks. Only ammo and missiles break.
 * ref: src/dothrow.c should_mulch_missile(): `chance = 3 - spe` (we have no erosion);
 * `chance > 1 ? rn2(chance) : !rn2(4)`; a blessed one survives 1 in 3 (monsters) or `!rnl(4)`
 * (the hero: rnl() is rn2() while Luck is 0); flint survives half of the time.
 */
export function shouldMulchMissile(ctx: Ctx, obj: Entity, monMoving: boolean): boolean {
  const it = obj.c.item;
  const def = ctx.defs.object(obj.def);
  if (!it || !(isAmmo(def) || isMissile(def)) || def.magic) return false;
  const chance = 3 - it.spe;
  let broken = chance > 1 ? ctx.rng.rn2(chance) !== 0 : ctx.rng.rn2(4) === 0;
  if (it.buc === 'blessed' && (monMoving ? ctx.rng.rn2(3) === 0 : ctx.rng.rn2(4) === 0))
    broken = false;
  // flint and hard gems do not break easily (ref: `oc_tough || FLINT`; only flint is in the table)
  if (obj.def === 'nh:flint_stone' && ctx.rng.rn2(2) === 0) broken = false;
  return broken;
}

// ---------------------------------------------------------------------------------------------
// the hero is hit

/**
 * A missile may hit the hero. Returns true on a hit. `tlev` is the pseudo-level (to-hit).
 * ref: src/mthrowu.c thitu(): `u.uac + tlev <= rnd(20)` misses; a miss by 2 or more is "misses
 * you", a nearer one "almost hit"; a hit costs `dam` hit points. Not ported: blindness, acid,
 * poison, silver, passes_rocks, thrown potions.
 */
function thitu(
  ctx: Ctx,
  tlev: number,
  dam: number,
  obj: Entity,
  nth: { key: string } | null,
): boolean {
  const hero = getPlayer(ctx.state);
  const uac = findAc(ctx.state, ctx.defs, hero.id);
  const name = xnameOf(ctx.state, ctx.defs, obj);
  const dieroll = ctx.rng.rnd(20);
  const k = nth ? '_nth' : '';
  const p: Record<string, Msg | string | number> = nth ? { obj: name, nth } : { obj: name };
  if (uac + tlev <= dieroll) {
    if (uac + tlev <= dieroll - 2) say(ctx, `mthrow.miss${k}`, p);
    else say(ctx, `mthrow.almost${k}`, p);
    return false;
  }
  // ref: src/zap.c exclam()
  say(ctx, `${dam <= 4 ? 'mthrow.hit' : 'mthrow.hit_hard'}${k}`, p);
  mdamageu(ctx, dam, `@${obj.def}`); // losehp(dam, killer_xname(obj), KILLED_BY)
  return true;
}

// ---------------------------------------------------------------------------------------------
// the flight

type ClearFn = (x1: number, y1: number, x2: number, y2: number) => boolean;

/** One shot of a volley, and who shot it. */
interface Shot {
  i: number;
  n: number;
  /** The shooter is seen by the hero (so a volley numbers its missiles). */
  seen: boolean;
}

const ordKey = (i: number): { key: string } => ({ key: `throw.ord.${i}` });

/**
 * The missile stops and lands (or breaks). ref: src/mthrowu.c drop_throw(): after a hit it
 * breaks per should_mulch_missile(); eggs, pies and venom always break (none exist here). Not
 * ported: stairs and holes, water, passive_obj().
 */
function dropThrow(ctx: Ctx, objId: EntityId, ohit: boolean, level: string, x: number, y: number) {
  const obj = ctx.state.entities[String(objId)];
  if (!obj?.c.item) return;
  if (ohit && shouldMulchMissile(ctx, obj, true)) ctx.remove(objId);
  else placeOnFloor(ctx, objId, level, x, y);
}

/**
 * A missile in flight hits a monster that is in its way. Returns true when it has stopped.
 * ref: src/mthrowu.c ohitmon(): `5 + find_mac + omon_adj` against rnd(20); hits do dmgval() and
 * may kill (the kill is not credited to the hero). Not ported: mimics, potions, eggs, poison,
 * silver, shades, blinding, aiming bonuses of the archer's level.
 */
function ohitmon(
  ctx: Ctx,
  monId: EntityId,
  objId: EntityId,
  range: number,
  at: PosComponent,
  flush: () => void,
): boolean {
  const mon = ctx.state.entities[String(monId)];
  const obj = ctx.state.entities[String(objId)];
  const m = mon?.c.monster;
  if (!mon || !m || !obj?.c.item) return false;
  const mdef = ctx.defs.monster(mon.def);
  const odef = ctx.defs.object(obj.def);
  const vis = isVisible(ctx.state, cellOf(ctx, at));
  const missile = xnameOf(ctx.state, ctx.defs, obj);
  const tmp = 5 + findMac(ctx.state, ctx.defs, monId) + omonAdj(mon, mdef, obj, odef);
  if (tmp < ctx.rng.rnd(20)) {
    if (vis) {
      flush();
      say(ctx, 'throw.miss', { missile, mon: `@${mon.def}` });
    }
    if (!range) {
      dropThrow(ctx, objId, false, at.level, mon.c.pos?.x ?? at.x, mon.c.pos?.y ?? at.y);
      return true;
    }
    return false;
  }
  const damage = dmgvalSized(ctx.rng, obj, odef, isBig(mdef));
  m.asleep = false;
  if (vis) {
    flush();
    say(ctx, damage <= 4 ? 'throw.hit' : 'throw.hit_hard', { missile, mon: `@${mon.def}` });
  }
  const hp = mon.c.hp;
  if (hp) hp.cur -= damage;
  if (!hp || hp.cur < 1) {
    if (vis) {
      const nonliving = mdef.flags.includes('undead') || mon.def === 'nh:manes';
      say(ctx, nonliving ? 'mthrow.mon_destroyed' : 'mthrow.mon_killed', { mon: `@${mon.def}` });
    }
    monsterDied(ctx, monId, false);
  }
  dropThrow(ctx, objId, true, at.level, at.x, at.y);
  return true;
}

const cellOf = (ctx: Ctx, p: PosComponent): number => {
  const level = ctx.state.levels[p.level];
  return level ? p.y * level.width + p.x : -1;
};

/** Whether the cell stops a missile: outside the map, a wall or rock, or a closed door. */
function flightBlocked(ctx: Ctx, level: string, x: number, y: number): boolean {
  const lv = ctx.state.levels[level];
  if (!lv || !inBounds(lv, x, y)) return true;
  const t = ctx.defs.terrain(lv.palette[lv.cells[y * lv.width + x] ?? 0] as DefId);
  return !t.passable || t.door === 'closed' || t.door === 'locked';
}

/**
 * One missile leaves the monster's stack and flies `range` cells in direction (dx, dy).
 * ref: src/mthrowu.c m_throw(). A cursed one may misfire in a random direction; it stops at a
 * wall or closed door, at the first monster it hits, at the hero (hit or miss), or when its
 * range is used up (a miss lands on the hero's square). Not ported: iron bars, sinks, tethered
 * weapons, shades, potions, eggs, pies, venom, blinding, poison.
 */
function mThrow(
  ctx: Ctx,
  monId: EntityId,
  dxIn: number,
  dyIn: number,
  rangeIn: number,
  stackId: EntityId,
  shot: Shot,
): void {
  const mon = ctx.state.entities[String(monId)];
  const stack = ctx.state.entities[String(stackId)];
  const mpos = mon?.c.pos;
  const hero = getPlayer(ctx.state);
  if (!mon || !mpos || !stack?.c.item) return;
  let dx = dxIn;
  let dy = dyIn;
  let range = rangeIn;

  // take one missile out of the monster's inventory (unwielding it if it was the weapon)
  const objId = stack.c.item.quantity > 1 ? splitStack(ctx, stackId, 1) : stackId;
  removeFromInventory(ctx, objId);
  const obj = ctx.state.entities[String(objId)];
  if (!obj?.c.item) return;
  const odef = ctx.defs.object(obj.def);
  const name = xnameOf(ctx.state, ctx.defs, obj);

  let x = mpos.x;
  let y = mpos.y;
  const level = mpos.level;

  if (obj.c.item.buc === 'cursed' && ctx.rng.rn2(7) === 0) {
    if (shot.seen) {
      if (isAmmo(odef)) say(ctx, 'mthrow.misfires', { mon: `@${mon.def}` });
      else say(ctx, 'mthrow.slips', { mon: `@${mon.def}`, obj: name });
    }
    dx = ctx.rng.rn2(3) - 1;
    dy = ctx.rng.rn2(3) - 1;
    if (!dx && !dy) {
      dropThrow(ctx, objId, false, level, x, y);
      return;
    }
  }
  if (flightBlocked(ctx, level, x + dx, y + dy)) {
    dropThrow(ctx, objId, false, level, x, y);
    return;
  }

  const lv = ctx.state.levels[level];
  const path: Pos[] = [];
  let emitted = false;
  // the animation is shown before the first message of the flight, and once
  const flush = (): void => {
    if (emitted || path.length === 0) return;
    emitted = true;
    ctx.emit({ type: 'projectile', g: shownId(ctx.state, obj.def), path: [...path] });
  };
  const nth = shot.n > 1 && shot.seen ? ordKey(shot.i) : null;
  let mesgGiven = false;

  while (range-- > 0) {
    x += dx;
    y += dy;
    if (lv && isVisible(ctx.state, y * lv.width + x)) path.push({ x, y });

    const other = monsterIdAt(ctx, { x, y }, level);
    const hpos = hero.c.pos;
    if (other !== null) {
      if (ohitmon(ctx, other, objId, range, { level, x, y }, flush)) {
        flush();
        return;
      }
    } else if (hpos && hpos.level === level && hpos.x === x && hpos.y === y) {
      stopOccupation(ctx);
      // ref: src/mthrowu.c u_catch_thrown_obj(): 1 in (100 - Dex) when able to move
      const dex = hero.c.attributes?.dex ?? 10;
      if (hero.c.helpless === undefined && ctx.rng.rn2(100 - dex) === 0) {
        flush();
        say(ctx, 'mthrow.catch', { obj: name });
        addToInventory(ctx, hero.id, objId);
        return;
      }
      // ref: m_throw(): to-hit is 8 + spe + 3 - distance (at least -4) (+1 for big heroes: no);
      // damage is dmgval(), at least 1
      const mdist = distmin(hpos.x, hpos.y, mpos.x, mpos.y);
      let hitv = 3 - mdist;
      if (hitv < -4) hitv = -4;
      hitv += 8 + obj.c.item.spe;
      let dam = dmgvalSized(ctx.rng, obj, odef, false);
      if (dam < 1) dam = 1;
      flush();
      const hit = thitu(ctx, hitv, dam, obj, nth);
      mesgGiven = true;
      if (hit) {
        dropThrow(ctx, objId, true, level, hpos.x, hpos.y);
        return;
      }
    }

    // ref: m_throw(): `forcehit = !rn2(5)` is rolled at every step (it matters for iron bars)
    ctx.rng.rn2(5);
    if (!range || flightBlocked(ctx, level, x + dx, y + dy)) {
      // end of path or blocked: it drops here
      const seeHere = lv ? isVisible(ctx.state, y * lv.width + x) : false;
      const hereIsHero = hero.c.pos?.x === x && hero.c.pos?.y === y;
      if (shot.n > 1 && (!mesgGiven || !hereIsHero) && seeHere) {
        flush();
        say(ctx, 'mthrow.lands_miss', { obj: name, nth: ordKey(shot.i) });
      }
      dropThrow(ctx, objId, false, level, x, y);
      flush();
      return;
    }
  }
  flush();
}

// ---------------------------------------------------------------------------------------------
// choosing and shooting

/**
 * ref: src/weapon.c rwep[]: the missiles a monster throws, best first. Entries this port lacks
 * are skipped by the lookup.
 */
const RWEP: readonly string[] = [
  'nh:dwarvish_spear',
  'nh:silver_spear',
  'nh:elven_spear',
  'nh:spear',
  'nh:orcish_spear',
  'nh:javelin',
  'nh:shuriken',
  'nh:ya',
  'nh:silver_arrow',
  'nh:elven_arrow',
  'nh:arrow',
  'nh:orcish_arrow',
  'nh:crossbow_bolt',
  'nh:silver_dagger',
  'nh:elven_dagger',
  'nh:dagger',
  'nh:orcish_dagger',
  'nh:knife',
  'nh:flint_stone',
  'nh:rock',
  'nh:loadstone',
  'nh:luckstone',
  'nh:dart',
  'nh:cream_pie',
];

/** ref: src/weapon.c select_rwep() `case P_BOW:` and friends: launchers in order of preference */
const LAUNCHERS: Record<string, readonly string[]> = {
  bow: ['nh:yumi', 'nh:elven_bow', 'nh:bow', 'nh:orcish_bow'],
  sling: ['nh:sling'],
  crossbow: ['nh:crossbow'],
};

export interface RangedChoice {
  /** The missile to throw or shoot; null when the monster has none it can use. */
  obj: Entity | null;
  /** The launcher to wield for it; null when it needs none (`&hands_obj`). */
  propellor: Entity | null;
}

/**
 * The monster's best ranged attack. ref: src/weapon.c select_rwep(): the first of rwep[] it
 * carries whose launcher (if any) it also has; sling stones before darts. Not ported: polearms
 * (none exist), throw-and-return aklys (monsters never throw them), boulders, cockatrice eggs
 * and cream pies, silver-haters, artifacts.
 */
export function selectRwep(ctx: Ctx, monId: EntityId): RangedChoice {
  const mon = ctx.state.entities[String(monId)];
  const none: RangedChoice = { obj: null, propellor: null };
  if (!mon) return none;
  const mdef = ctx.defs.monster(mon.def);
  const items = minvent(ctx, monId);
  const find = (id: string): Entity | null => items.find((o) => o.def === id) ?? null;
  const mwep = monWep(ctx, monId);
  const weldedWep = mwep?.c.item?.buc === 'cursed';
  const noWeaponWanted = monFlag(ctx, 'nowep', monId);

  for (const id of RWEP) {
    // shooting gems from slings; this goes just before the darts
    if (id === 'nh:dart' && !mdef.flags.includes('jewels')) {
      const sling = find('nh:sling');
      if (sling) {
        const gem = items.find(
          (o) => ctx.defs.object(o.def).class === 'gem' && o.def !== 'nh:loadstone',
        );
        if (gem) return { obj: gem, propellor: sling };
      }
    }
    if (!ctx.defs.isObject(id as DefId)) continue;
    const od = ctx.defs.object(id as DefId);
    let launcher: Entity | null = null;
    let usable = true;
    if (isAmmo(od)) {
      for (const lid of LAUNCHERS[od.weapon?.skill ?? ''] ?? []) {
        launcher = find(lid);
        if (launcher) break;
      }
      usable = launcher !== null;
    }
    // a welded weapon that is not the launcher rules out missiles that need a free hand
    if ((isAmmo(od) || isMissile(od)) && mwep && weldedWep && noWeaponWanted && mwep !== launcher)
      usable = false;
    if (!usable) continue;
    const o = find(id);
    if (!o) continue;
    // Don't throw a cursed weapon-in-hand
    if (o === mwep && weldedWep) continue;
    return { obj: o, propellor: launcher };
  }
  return none;
}

/** ref: src/mthrowu.c monmulti(): the number of missiles in a volley */
function monmulti(ctx: Ctx, monId: EntityId, otmp: Entity, mwep: Entity | null): number {
  const mon = ctx.state.entities[String(monId)];
  const it = otmp.c.item;
  if (!mon || !it) return 1;
  const mdef = ctx.defs.monster(mon.def);
  const odef = ctx.defs.object(otmp.def);
  const wdef = mwep ? ctx.defs.object(mwep.def) : null;
  let multishot = 1;
  if (it.quantity > 1 && (isAmmo(odef) ? matchingLauncher(odef, wdef) : odef.class === 'weapon')) {
    // Assumes lords are skilled, princes are expert
    if (mdef.flags.includes('prince')) multishot += 2;
    else if (mdef.flags.includes('lord')) multishot++;
    // Elven craftsmanship makes for light, quick bows
    if (otmp.def === 'nh:elven_arrow' && it.buc !== 'cursed') multishot++;
    if (
      mwep?.def === 'nh:elven_bow' &&
      ammoAndLauncher(odef, wdef) &&
      mwep.c.item?.buc !== 'cursed'
    )
      multishot++;
    // 1/3 of launcher enchantment (rounddiv)
    const spe = mwep?.c.item?.spe ?? 0;
    if (ammoAndLauncher(odef, wdef) && spe > 1) multishot += Math.trunc((spe + 1) / 3);
    multishot = ctx.rng.rnd(multishot);
    // racial bonus
    if (
      (mdef.flags.includes('elf') &&
        otmp.def === 'nh:elven_arrow' &&
        mwep?.def === 'nh:elven_bow') ||
      (mdef.flags.includes('orc') &&
        otmp.def === 'nh:orcish_arrow' &&
        mwep?.def === 'nh:orcish_bow') ||
      (mdef.flags.includes('gnome') &&
        otmp.def === 'nh:crossbow_bolt' &&
        mwep?.def === 'nh:crossbow')
    )
      multishot++;
  }
  if (it.quantity < multishot) multishot = it.quantity;
  if (multishot < 1) multishot = 1;
  return multishot;
}

/**
 * The monster throws or shoots `otmp` at the hero, who is in line at distance `dm`.
 * ref: src/mthrowu.c monshoot(): announces "N arrows" or "an arrow" when seen, then one m_throw
 * per missile.
 */
function monshoot(ctx: Ctx, monId: EntityId, otmp: Entity, mwep: Entity | null, dm: number): void {
  const mon = ctx.state.entities[String(monId)];
  const hero = getPlayer(ctx.state);
  const mpos = mon?.c.pos;
  const hpos = hero.c.pos;
  const it = otmp.c.item;
  if (!mon || !mpos || !hpos || !it) return;
  const odef = ctx.defs.object(otmp.def);
  const wdef = mwep ? ctx.defs.object(mwep.def) : null;
  const multishot = monmulti(ctx, monId, otmp, mwep);
  const seen = heroSees(ctx, mpos);
  if (seen) {
    const shoots = ammoAndLauncher(odef, wdef);
    if (multishot > 1) {
      say(ctx, shoots ? 'mthrow.shoots_n' : 'mthrow.throws_n', {
        mon: `@${mon.def}`,
        n: multishot,
        item: xnameOf(ctx.state, ctx.defs, otmp),
      });
    } else {
      const one = { ...otmp, c: { ...otmp.c, item: { ...it, quantity: 1 } } };
      say(ctx, shoots ? 'mthrow.shoots' : 'mthrow.throws', {
        mon: `@${mon.def}`,
        item: xnameOf(ctx.state, ctx.defs, one),
      });
    }
  }
  const dx = Math.sign(hpos.x - mpos.x);
  const dy = Math.sign(hpos.y - mpos.y);
  for (let i = 1; i <= multishot; i++) {
    // the stack may have merged away if the shooter died in between (it cannot yet: no passives)
    if (!ctx.state.entities[String(otmp.id)]?.c.item) break;
    mThrow(ctx, monId, dx, dy, dm, otmp.id, { i, n: multishot, seen });
    if (!ctx.state.entities[String(monId)]) break; // the shooter died
  }
}

/**
 * Whether the hero is in line with the monster: same row, column or diagonal, closer than
 * BOLT_LIM, and the monster's square in her line of sight. ref: src/mthrowu.c linedup() (no
 * boulders in this port, so only the clear path counts)
 */
export function linedUp(mon: Pos, hero: Pos, clear: ClearFn): boolean {
  const tbx = hero.x - mon.x;
  const tby = hero.y - mon.y;
  if (tbx === 0 && tby === 0) return false;
  if (
    (tbx === 0 || tby === 0 || Math.abs(tbx) === Math.abs(tby)) &&
    distmin(tbx, tby, 0, 0) < BOLT_LIM
  )
    return clear(hero.x, hero.y, mon.x, mon.y);
  return false;
}

/**
 * A monster uses its ranged weapon against the hero (it is not next to her). It first wields
 * the launcher it needs (that takes its move); then, if the hero is lined up, it throws or
 * shoots. If she is moving away it only does so with a chance that falls with distance.
 * ref: src/mthrowu.c thrwmu(). `clear` is the line-of-sight test; `prevHero` is where the monster
 * last saw her (the hero's u.ux0/u.uy0), or null.
 * Returns true when the monster used its move to wield something.
 */
export function thrwmu(ctx: Ctx, monId: EntityId, clear: ClearFn, prevHero: Pos | null): boolean {
  const mon = ctx.state.entities[String(monId)];
  const hero = getPlayer(ctx.state);
  const mpos = mon?.c.pos;
  const hpos = hero.c.pos;
  if (!mon || !mpos || !hpos) return false;

  // "Rearranged beginning so monsters can use polearms not in a line": wield first
  if (!monFlag(ctx, 'nowep', monId) || !monWep(ctx, monId)) {
    const { propellor } = selectRwep(ctx, monId);
    if (propellor && monWield(ctx, monId, propellor)) return true;
  }

  const { obj } = selectRwep(ctx, monId);
  if (!obj) return false;

  // If you are coming toward the monster, the monster should try to soften you up with
  // missiles. If you are going away, you are probably hurt or running. Give chase, but if you
  // are getting too far away, throw.
  const retreating =
    prevHero !== null &&
    distmin(hpos.x, hpos.y, mpos.x, mpos.y) > distmin(prevHero.x, prevHero.y, mpos.x, mpos.y);
  if (!linedUp(mpos, hpos, clear)) return false;
  if (retreating && ctx.rng.rn2(BOLT_LIM - distmin(mpos.x, mpos.y, hpos.x, hpos.y)) !== 0)
    return false;

  monshoot(ctx, monId, obj, monWep(ctx, monId), distmin(mpos.x, mpos.y, hpos.x, hpos.y));
  stopOccupation(ctx);
  return false;
}

/**
 * A monster that is in range but not next to the hero makes the ranged part of its attack:
 * each weapon attack becomes thrwmu(). ref: src/mhitu.c mattacku() `case AT_WEAP: if (range2)
 * thrwmu(mtmp)`.
 */
export function mattackRanged(
  ctx: Ctx,
  monId: EntityId,
  clear: ClearFn,
  prevHero: Pos | null,
): void {
  const mon = ctx.state.entities[String(monId)];
  if (!mon) return;
  const def = ctx.defs.monster(mon.def);
  for (const a of def.attacks) {
    if (a.at !== 'weapon') continue;
    thrwmu(ctx, monId, clear, prevHero);
    break;
  }
}
