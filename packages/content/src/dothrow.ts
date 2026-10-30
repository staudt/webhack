// Throwing objects. ref: src/dothrow.c dothrow(), throw_obj(), throwit(), thitmonst(), tmiss(),
// hitfloor(); src/zap.c bhit() (thrown objects only); src/uhitm.c hmon_hitmon()
import {
  DIRS,
  DIR_LIST,
  NORMAL_SPEED,
  inBounds,
  inventoryOf,
  isVisible,
  shownId,
  type ActionDef,
  type Ctx,
  type DefId,
  type Dir,
  type Entity,
  type EntityId,
  type Json,
  type MonsterDef,
  type Msg,
  type ObjectDef,
  type Offer,
  type PlayerAction,
  type Pos,
  type PromptOption,
} from '@nh/core';
import { dbon, dmgval, monsterIdAt } from './combat';
import { monsterDied } from './mondeath';
import { experienceFor, gainExperience } from './hero';
import { encumberMsg } from './itemactions';
import { placeOnFloor, removeFromInventory, splitStack, weight } from './items';
import { checkCapacity, heroEntity } from './magic';
import { xnameOf } from './objnam';
import {
  ammoAndLauncher,
  isAmmo,
  isMissile,
  matchingLauncher,
  omonAdj,
  shouldMulchMissile,
} from './mthrowu';
import { P_EXPERT, P_SKILLED, skillLevel, weaponDamBonus, weaponHitBonus } from './skills';
import { acurrstr, findMac } from './stats';

export const THROW_ID: DefId = 'nh:throw';

/** ref: include/hack.h BOLT_LIM */
const BOLT_LIM = 8;

const msg = (ctx: Ctx, key: string, params?: Record<string, Msg | string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

/**
 * ref: src/dothrow.c throwing_weapon(): missiles (darts), spears, daggers and knives (pierce
 * blades that are not swords) and the aklys are meant to be thrown. (We have no war hammers.)
 */
function throwingWeapon(def: ObjectDef): boolean {
  const skill = def.weapon?.skill;
  return (
    isMissile(def) ||
    skill === 'spear' ||
    skill === 'dagger' ||
    skill === 'knife' ||
    def.id === 'nh:aklys'
  );
}

/** The hero's wielded weapon (the launcher, for ammo), if any. */
function heroWielded(ctx: Ctx): Entity | null {
  return (
    inventoryOf(ctx.state, ctx.state.playerId).find((o) => o.c.item?.equipped === 'weapon') ?? null
  );
}

const distmin = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** ref: src/mon.c wakeup(mtmp, TRUE) */
function wakeup(mon: { asleep: boolean; peaceful: boolean }): void {
  mon.asleep = false;
  mon.peaceful = false;
}

/** ref: src/zap.c exclam() */
const exclam = (force: number): string => (force < 0 ? '?' : force <= 4 ? '.' : '!');

/** The ordinal of a volley shot, "the 2nd dagger". ref: src/objnam.c mshot_xname() */
interface Shot {
  i: number;
  n: number;
}

const missileMsg = (
  ctx: Ctx,
  key: string,
  shot: Shot,
  missile: Msg,
  params: Record<string, Msg | string | number>,
): void => {
  if (shot.n > 1) {
    msg(ctx, `${key}_nth`, { ...params, missile, nth: { key: `throw.ord.${shot.i}` } });
  } else msg(ctx, key, { ...params, missile });
};

// ---------------------------------------------------------------------------------------------
// hitting a monster

/** ref: src/dothrow.c tmiss(): "The dagger misses the newt." and a 1 in 3 chance to wake it. */
function tmiss(ctx: Ctx, mon: Entity, missile: Msg, shot: Shot): void {
  missileMsg(ctx, 'throw.miss', shot, missile, { mon: `@${mon.def}` });
  if (mon.c.monster && ctx.rng.rn2(3) === 0) wakeup(mon.c.monster);
}

/** ref: src/include/mondata.h nonliving(): undead and manes (our data has no other cases) */
const nonliving = (def: MonsterDef): boolean =>
  def.flags.includes('undead') || def.id === 'nh:manes';

/**
 * The thrown object tries to hit the monster; returns true when it was used up (a missile that
 * broke). ref: src/dothrow.c thitmonst(): to-hit is -1 + AC + level + Dex bonus + distance
 * (3 - distance, at least -4) + size + sleeping + hitval; ammo shot from its launcher adds the
 * launcher's enchantment and skill bonus, ammo thrown by hand is -4, other weapons get +2 when
 * meant to be thrown (-2 when not) and the skill bonus; `tmp >= rnd(20)` hits; then
 * src/uhitm.c hmon(): ammo shot from its launcher does dmgval() plus the launcher's skill damage
 * bonus (no Str bonus), ammo thrown by hand only rnd(2) plus the Str bonus. Hits may break the
 * missile (should_mulch_missile). Not ported: Luck, rings, gloves with bows, racial bows,
 * unicorns, the quest leader, boomerangs and balls, eggs and cream pies, thrown potions (they
 * land without breaking), taming with food, passive responses, poison, silver, knockback.
 */
export function thitmonst(ctx: Ctx, monId: EntityId, objId: EntityId, shot: Shot): boolean {
  const mon = ctx.state.entities[String(monId)];
  const obj = ctx.state.entities[String(objId)];
  const m = mon?.c.monster;
  const hero = heroEntity(ctx);
  if (!mon || !m || !obj?.c.item || !hero.c.pos || !mon.c.pos) return false;
  const mdef = ctx.defs.monster(mon.def);
  const odef = ctx.defs.object(obj.def);
  const dex = hero.c.attributes?.dex ?? 10;
  const ulevel = hero.c.experience?.level ?? 1;

  let tmp = -1 + findMac(ctx.state, ctx.defs, monId) + ulevel;
  if (dex < 4) tmp -= 3;
  else if (dex < 6) tmp -= 2;
  else if (dex < 8) tmp -= 1;
  else if (dex >= 14) tmp += dex - 14;
  // distance: close targets are easier
  let disttmp = 3 - distmin(hero.c.pos.x, hero.c.pos.y, mon.c.pos.x, mon.c.pos.y);
  if (disttmp < -4) disttmp = -4;
  tmp += disttmp;
  tmp += omonAdj(mon, mdef, obj, odef);

  const dieroll = ctx.rng.rnd(20);
  const missile = xnameOf(ctx.state, ctx.defs, obj);
  const name = `@${mon.def}`;

  if ((odef.class !== 'weapon' && odef.class !== 'gem') || !odef.weapon) {
    tmiss(ctx, mon, missile, shot);
    return false;
  }
  const uwep = heroWielded(ctx);
  const uwdef = uwep ? ctx.defs.object(uwep.def) : null;
  const launched = uwep !== null && uwdef !== null && ammoAndLauncher(odef, uwdef);
  if (isAmmo(odef)) {
    if (!launched) tmp -= 4;
    else {
      tmp += uwep.c.item?.spe ?? 0;
      tmp += weaponHitBonus(skillLevel(ctx, uwdef.weapon?.skill ?? ''), uwdef);
    }
  } else {
    // thrown non-ammo: +2 for a weapon meant to be thrown, -2 otherwise, plus the skill bonus
    tmp += throwingWeapon(odef) ? 2 : -2;
    tmp += weaponHitBonus(skillLevel(ctx, odef.weapon.skill), odef);
  }
  if (!(tmp >= dieroll)) {
    tmiss(ctx, mon, missile, shot);
    return false;
  }

  let dmg: number;
  if (isAmmo(odef) && !launched) {
    // ref: hmon_hitmon_weapon_ranged(): "then do only 1-2 points of damage"; no skill bonus
    dmg = ctx.rng.rnd(2) + dbon(hero.c.attributes?.str ?? 10);
  } else if (launched && uwdef) {
    // a propellor gives the launcher's skill bonus but not a strength one
    dmg = dmgval(ctx.rng, obj, odef, mdef);
    dmg += weaponDamBonus(skillLevel(ctx, uwdef.weapon?.skill ?? ''), uwdef);
  } else {
    // ref: src/uhitm.c hmon_hitmon_weapon_melee(): dmgval, then the Str bonus and the
    // weapon-skill bonus; at least 1.
    dmg = dmgval(ctx.rng, obj, odef, mdef);
    dmg += dbon(hero.c.attributes?.str ?? 10);
    dmg += weaponDamBonus(skillLevel(ctx, odef.weapon.skill), odef);
  }
  if (dmg < 1) dmg = 1;

  const hp = mon.c.hp;
  if (hp) hp.cur -= dmg;
  if (!hp || hp.cur < 1) {
    // ref: src/mon.c xkilled(): "You kill/destroy <mon>!" then experience()
    msg(ctx, nonliving(mdef) ? 'combat.you_destroy' : 'combat.you_kill', { mon: name });
    monsterDied(ctx, monId, true);
    gainExperience(ctx, hero.id, experienceFor(mdef, m.level));
  } else {
    // ref: src/uhitm.c hmon_hitmon_msg_hit(): "The dagger hits the newt" + exclam(dmg)
    missileMsg(ctx, exclam(dmg) === '!' ? 'throw.hit_hard' : 'throw.hit', shot, missile, {
      mon: name,
    });
    wakeup(m);
  }
  // projectiles other than magic stones sometimes disappear when thrown
  if (shouldMulchMissile(ctx, obj, false)) {
    ctx.remove(objId);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// the flight

/**
 * Flies the (detached) object from the hero in direction `dir`, hits what is in the way and
 * leaves it on the floor. ref: src/dothrow.c throwit(), src/zap.c bhit(), src/dothrow.c hitfloor()
 */
function throwit(ctx: Ctx, objId: EntityId, dir: Dir, shot: Shot): void {
  const hero = heroEntity(ctx);
  const pos = hero.c.pos;
  const obj = ctx.state.entities[String(objId)];
  const it = obj?.c.item;
  const level = pos ? ctx.state.levels[pos.level] : undefined;
  if (!pos || !obj || !it || !level) return;
  const odef = ctx.defs.object(obj.def);
  let { x: dx, y: dy } = DIRS[dir];
  let dz = 0;

  const uwep = heroWielded(ctx);
  const uwdef = uwep ? ctx.defs.object(uwep.def) : null;
  const launched = uwdef !== null && ammoAndLauncher(odef, uwdef);

  // a cursed object may slip (or ammo misfire): it goes off in a random direction (or just drops)
  if (it.buc === 'cursed' && ctx.rng.rn2(7) === 0) {
    if (launched) {
      msg(ctx, 'throw.misfires', { item: xnameOf(ctx.state, ctx.defs, obj) });
    } else if (throwingWeapon(odef)) {
      msg(ctx, 'throw.slips', { item: xnameOf(ctx.state, ctx.defs, obj) });
    }
    if (launched || throwingWeapon(odef)) {
      dx = ctx.rng.rn2(3) - 1;
      dy = ctx.rng.rn2(3) - 1;
      if (!dx && !dy) dz = 1;
    }
  }

  if (dz) {
    // ref: src/dothrow.c hitfloor(): "It hits the floor." then it lands at the hero's feet
    msg(ctx, `throw.floor${it.quantity !== 1 ? '_pl' : ''}`, {
      item: ctx.defs.itemName(ctx.state, obj),
    });
    placeOnFloor(ctx, objId, pos.level, pos.x, pos.y);
    return;
  }

  // range = ACURRSTR / 2 - weight / 40, at least 1; a crossbow's range does not depend on Str
  const crossbowing = launched && odef.weapon?.skill === 'crossbow';
  const urange = Math.trunc((crossbowing ? 18 : acurrstr(hero.c.attributes?.str ?? 10)) / 2);
  let range = urange - Math.trunc(weight(ctx.defs, obj) / 40);
  if (range < 1) range = 1;
  if (isAmmo(odef)) {
    if (launched) {
      // shot from its launcher: one farther, or a bolt's full BOLT_LIM
      range = crossbowing ? BOLT_LIM : range + 1;
    } else if (odef.class !== 'gem') {
      // thrown by hand: half the range, and the hero says so
      range = Math.trunc(range / 2);
      msg(ctx, `throw.by_hand.${odef.weapon?.skill ?? 'bow'}`);
    }
  }

  // ref: src/zap.c bhit() for THROWN_WEAPON: a monster stops it; so does anything that is not
  // open floor (a wall, stone, a closed door), in which case it drops in the cell before.
  let x = pos.x;
  let y = pos.y;
  let hitMon: EntityId | null = null;
  const path: Pos[] = []; // the cells of the flight the hero can see
  while (range-- > 0) {
    x += dx;
    y += dy;
    if (!inBounds(level, x, y)) {
      x -= dx;
      y -= dy;
      break;
    }
    const t = ctx.defs.terrain(level.palette[level.cells[y * level.width + x] ?? 0] as DefId);
    const blocked = !t.passable || t.door === 'closed' || t.door === 'locked';
    const mid = blocked ? null : monsterIdAt(ctx, { x, y }, pos.level);
    if (blocked) {
      x -= dx;
      y -= dy;
      break;
    }
    // ref: src/zap.c bhit() tmp_at(): the cell is drawn only when the hero can see it
    if (isVisible(ctx.state, y * level.width + x)) path.push({ x, y });
    if (mid !== null) {
      hitMon = mid;
      break;
    }
  }
  // ref: src/dothrow.c throwit() tmp_at(DISP_FLASH, obj_to_glyph(obj)); the UI animates it first
  if (path.length > 0) ctx.emit({ type: 'projectile', g: shownId(ctx.state, obj.def), path });

  if (hitMon !== null) {
    if (thitmonst(ctx, hitMon, objId, shot)) return; // used up
  }
  placeOnFloor(ctx, objId, pos.level, x, y);
}

// ---------------------------------------------------------------------------------------------
// the command

/** ref: src/dothrow.c multishot_class_bonus(): the roles' bonuses (only the Valkyrie exists: none) */
const multishotClassBonus = (): number => 0;

/**
 * How many to throw or shoot at once. ref: src/dothrow.c throw_obj() "Multishot calculations":
 * only for stacks of weapons (ammo only with its launcher wielded); skilled gives +1 and expert
 * +2 (unless Dex <= 6, which allows none); a crossbow needs Str 18 to fire several; then rnd()
 * of the total. Not ported: confusion/stun, role and race bonuses, fumbling.
 */
function multishotOf(ctx: Ctx, obj: Entity, def: ObjectDef): number {
  const it = obj.c.item;
  if (!it || it.quantity <= 1 || !def.weapon || (def.class !== 'weapon' && !isAmmo(def))) return 1;
  const uwep = heroWielded(ctx);
  const uwdef = uwep ? ctx.defs.object(uwep.def) : null;
  if (isAmmo(def) ? !matchingLauncher(def, uwdef) : def.class !== 'weapon') return 1;
  const attrs = heroEntity(ctx).c.attributes;
  const weak = (attrs?.dex ?? 10) <= 6;
  let multishot = 1;
  const skill = skillLevel(ctx, def.weapon.skill);
  if (skill === P_EXPERT) multishot++;
  if ((skill === P_EXPERT || skill === P_SKILLED) && !weak) multishot++;
  multishot += multishotClassBonus();
  // crossbows are slow to load: high strength is necessary to shoot quickly
  if (
    multishot > 1 &&
    def.weapon.skill === 'crossbow' &&
    ammoAndLauncher(def, uwdef) &&
    acurrstr(attrs?.str ?? 10) < 18
  )
    multishot = ctx.rng.rnd(multishot);
  multishot = ctx.rng.rnd(multishot);
  return Math.min(multishot, it.quantity);
}

/** The wielded weapon is stuck to the hand. ref: src/wield.c welded(), weldmsg() */
function weldedHere(ctx: Ctx, e: Entity): boolean {
  const it = e.c.item;
  if (!it || it.equipped !== 'weapon' || it.buc !== 'cursed') return false;
  it.known.buc = true;
  return true;
}

/** Throws the object (a stack) in a direction; returns the energy used. ref: src/dothrow.c throw_obj() */
export function throwObj(ctx: Ctx, obj: Entity, dir: Dir): number {
  const it = obj.c.item;
  if (!it) return 0;
  const def = ctx.defs.object(obj.def);
  // canletgo(): worn armor stays on
  if (it.equipped !== null && it.equipped !== 'weapon') {
    msg(ctx, 'throw.worn');
    return 0;
  }
  if (weldedHere(ctx, obj)) {
    const bi = def.weapon?.bimanual === true;
    const pl = it.quantity !== 1;
    msg(ctx, `wield.welded${pl ? '_pl' : ''}${bi ? '_hands' : ''}`, {
      item: xnameOf(ctx.state, ctx.defs, obj),
    });
    return NORMAL_SPEED;
  }

  const n = multishotOf(ctx, obj, def);
  if (n > 1) {
    const many = { ...obj, c: { ...obj.c, item: { ...it, quantity: n } } };
    const uw = heroWielded(ctx);
    const shoots = uw !== null && ammoAndLauncher(def, ctx.defs.object(uw.def));
    msg(ctx, shoots ? 'throw.volley_shoot' : 'throw.volley', {
      n,
      item: xnameOf(ctx.state, ctx.defs, many),
    });
  }
  let current: Entity | null = obj;
  for (let i = 1; i <= n; i++) {
    if (!current) break;
    const cit: NonNullable<Entity['c']['item']> | undefined = current.c.item;
    if (!cit) break;
    // split this object off from its slot if necessary
    let id: EntityId;
    if (cit.quantity > 1) id = splitStack(ctx, current.id, 1);
    else {
      id = current.id;
      current = null;
    }
    removeFromInventory(ctx, id);
    throwit(ctx, id, dir, { i, n });
    encumberMsg(ctx);
    if (ctx.state.gameOver) break;
  }
  return NORMAL_SPEED;
}

export const heroItem = (ctx: Ctx, id: unknown): Entity | null => {
  if (typeof id !== 'number') return null;
  const e = ctx.state.entities[String(id)];
  return e?.c.item?.carriedBy === ctx.state.playerId ? e : null;
};

export function itemArg(action: PlayerAction): unknown {
  return action.type === 'mod' ? (action.args as { item?: unknown } | undefined)?.item : undefined;
}

export const DIRECTION_OPTIONS: PromptOption[] = DIR_LIST.map((d) => ({
  value: d,
  key: `dir.${d}`,
}));

const throwAction: ActionDef = {
  id: THROW_ID,
  labelKey: 'action.nh:throw',
  handles: 'mod',
  offer(ctx, target): Offer[] {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    const it = e?.c.item;
    if (!e || !it || ctx.defs.object(e.def).class === 'coin') return [];
    // worn armor cannot be thrown, nor a weapon known to be welded to the hand
    if (it.equipped !== null && it.equipped !== 'weapon') return [];
    if (it.equipped === 'weapon' && it.buc === 'cursed' && it.known.buc) return [];
    return [
      {
        action: { type: 'mod', action: THROW_ID, args: { item: e.id } },
        labelKey: 'action.nh:throw',
      },
    ];
  },
  // ref: src/dothrow.c dothrow(): ok_to_throw(), then getobj() and throw_obj() asks "In what direction?"
  perform(ctx, action) {
    const e = heroItem(ctx, itemArg(action));
    if (!e) return 0;
    if (checkCapacity(ctx)) return 0;
    ctx.ask(
      {
        id: 'throw-direction',
        kind: 'direction',
        key: 'throw.direction',
        options: DIRECTION_OPTIONS,
      },
      THROW_ID,
      { item: e.id },
    );
    return 0;
  },
  answer(ctx, value: Json, raw: Json) {
    const id = (raw as { item?: unknown } | null)?.item;
    const e = heroItem(ctx, id);
    const dir = DIR_LIST.find((d) => d === value);
    if (!e || !dir) return 0; // cancelled
    return throwObj(ctx, e, dir);
  },
};

export const THROW_ACTIONS: readonly ActionDef[] = [throwAction];
