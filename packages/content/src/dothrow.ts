// Throwing objects. ref: src/dothrow.c dothrow(), throw_obj(), throwit(), thitmonst(), tmiss(),
// hitfloor(); src/zap.c bhit() (thrown objects only); src/uhitm.c hmon_hitmon()
import {
  DIRS,
  DIR_LIST,
  NORMAL_SPEED,
  inBounds,
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
  type PromptOption,
} from '@nh/core';
import { dbon, dmgval, hitval, monsterIdAt } from './combat';
import { monsterDied } from './mondeath';
import { experienceFor, gainExperience } from './hero';
import { encumberMsg } from './itemactions';
import { placeOnFloor, removeFromInventory, splitStack, weight } from './items';
import { checkCapacity, heroEntity } from './magic';
import { xnameOf } from './objnam';
import { P_EXPERT, P_SKILLED, skillLevel, weaponDamBonus, weaponHitBonus } from './skills';
import { acurrstr, findMac } from './stats';

export const THROW_ID: DefId = 'nh:throw';

const msg = (ctx: Ctx, key: string, params?: Record<string, Msg | string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

/** ref: include/mondata.h: MZ_TINY 0 .. MZ_HUGE 4, MZ_GIGANTIC 7 */
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
 * ref: src/dothrow.c throwing_weapon(): spears, daggers and knives (pierce blades that are not
 * swords) and the aklys are meant to be thrown. (We have no missiles, war hammers or ammo.)
 */
function throwingWeapon(def: ObjectDef): boolean {
  const skill = def.weapon?.skill;
  return skill === 'spear' || skill === 'dagger' || skill === 'knife' || def.id === 'nh:aklys';
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

/** ref: src/dothrow.c omon_adj(): size, sleeping and the object's own hit bonus */
function omonAdj(mon: Entity, mdef: MonsterDef, obj: Entity, odef: ObjectDef): number {
  let tmp = SIZE[mdef.size] - MZ_MEDIUM; // -2..+5
  if (mon.c.monster?.asleep) tmp += 2;
  if (mdef.speed === 0) tmp += 4; // immobile
  if (odef.class === 'weapon') tmp += hitval(obj, odef, mdef);
  return tmp;
}

/** ref: src/dothrow.c tmiss(): "The dagger misses the newt." and a 1 in 3 chance to wake it. */
function tmiss(ctx: Ctx, mon: Entity, missile: Msg, shot: Shot): void {
  missileMsg(ctx, 'throw.miss', shot, missile, { mon: `@${mon.def}` });
  if (mon.c.monster && ctx.rng.rn2(3) === 0) wakeup(mon.c.monster);
}

/** ref: src/include/mondata.h nonliving(): undead and manes (our data has no other cases) */
const nonliving = (def: MonsterDef): boolean =>
  def.flags.includes('undead') || def.id === 'nh:manes';

/**
 * The thrown object tries to hit the monster; returns true when it was used up (never, for the
 * objects we have). ref: src/dothrow.c thitmonst(): to-hit is -1 + AC + level + Dex bonus +
 * distance (3 - distance, at least -4) + size + sleeping + hitval + 2 for a throwing weapon +
 * skill bonus, and `tmp >= rnd(20)` hits; then src/uhitm.c hmon(). Not ported: Luck, rings,
 * gems and unicorns, the quest leader, boomerangs and balls, eggs and cream pies, thrown potions
 * (they land without breaking), taming with food, passive responses, poison, silver, knockback.
 */
function thitmonst(ctx: Ctx, monId: EntityId, objId: EntityId, shot: Shot): boolean {
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

  if (odef.class !== 'weapon' || !odef.weapon) {
    tmiss(ctx, mon, missile, shot);
    return false;
  }
  // thrown non-ammo: +2 for a weapon meant to be thrown, -2 otherwise, plus the skill bonus
  tmp += throwingWeapon(odef) ? 2 : -2;
  const skill = skillLevel(ctx, odef.weapon.skill);
  tmp += weaponHitBonus(skill, odef);
  if (!(tmp >= dieroll)) {
    tmiss(ctx, mon, missile, shot);
    return false;
  }

  // ref: src/uhitm.c hmon_hitmon_weapon_melee(): dmgval, then the Str bonus (no launcher) and
  // the weapon-skill bonus; at least 1.
  let dmg = dmgval(ctx.rng, obj, odef, mdef);
  if (dmg > 0) {
    dmg += dbon(hero.c.attributes?.str ?? 10);
    dmg += weaponDamBonus(skill, odef);
    if (dmg < 1) dmg = 1;
  } else dmg = 1;

  const hp = mon.c.hp;
  if (hp) hp.cur -= dmg;
  if (!hp || hp.cur < 1) {
    // ref: src/mon.c xkilled(): "You kill/destroy <mon>!" then experience()
    msg(ctx, nonliving(mdef) ? 'combat.you_destroy' : 'combat.you_kill', { mon: name });
    monsterDied(ctx, monId, true);
    gainExperience(ctx, hero.id, experienceFor(mdef, m.level));
    return false;
  }
  // ref: src/uhitm.c hmon_hitmon_msg_hit(): "The dagger hits the newt" + exclam(dmg)
  missileMsg(ctx, exclam(dmg) === '!' ? 'throw.hit_hard' : 'throw.hit', shot, missile, {
    mon: name,
  });
  wakeup(m);
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

  // a cursed object may slip: it goes off in a random direction (or just drops)
  if (it.buc === 'cursed' && ctx.rng.rn2(7) === 0) {
    if (throwingWeapon(odef)) {
      msg(ctx, 'throw.slips', { item: xnameOf(ctx.state, ctx.defs, obj) });
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

  // range = ACURRSTR / 2 - weight / 40, at least 1
  const urange = Math.trunc(acurrstr(hero.c.attributes?.str ?? 10) / 2);
  let range = urange - Math.trunc(weight(ctx.defs, obj) / 40);
  if (range < 1) range = 1;

  // ref: src/zap.c bhit() for THROWN_WEAPON: a monster stops it; so does anything that is not
  // open floor (a wall, stone, a closed door), in which case it drops in the cell before.
  let x = pos.x;
  let y = pos.y;
  let hitMon: EntityId | null = null;
  while (range-- > 0) {
    x += dx;
    y += dy;
    if (!inBounds(level, x, y)) {
      x -= dx;
      y -= dy;
      break;
    }
    const mid = monsterIdAt(ctx, { x, y }, pos.level);
    if (mid !== null) {
      hitMon = mid;
      break;
    }
    const t = ctx.defs.terrain(level.palette[level.cells[y * level.width + x] ?? 0] as DefId);
    if (!t.passable || t.door === 'closed') {
      x -= dx;
      y -= dy;
      break;
    }
  }

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
 * How many to throw at once. ref: src/dothrow.c throw_obj() "Multishot calculations": only for
 * stacks of weapons; skilled gives +1 and expert +2 (unless Dex <= 6, which allows none); then
 * rnd() of the total. Not ported: confusion/stun, ammo and launchers, race bonuses, fumbling.
 */
function multishotOf(ctx: Ctx, obj: Entity, def: ObjectDef): number {
  const it = obj.c.item;
  if (!it || it.quantity <= 1 || def.class !== 'weapon' || !def.weapon) return 1;
  const dex = heroEntity(ctx).c.attributes?.dex ?? 10;
  const weak = dex <= 6;
  let multishot = 1;
  const skill = skillLevel(ctx, def.weapon.skill);
  if (skill === P_EXPERT) multishot++;
  if ((skill === P_EXPERT || skill === P_SKILLED) && !weak) multishot++;
  multishot += multishotClassBonus();
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
function throwObj(ctx: Ctx, obj: Entity, dir: Dir): number {
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
    msg(ctx, 'throw.volley', { n, item: xnameOf(ctx.state, ctx.defs, many) });
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

const heroItem = (ctx: Ctx, id: unknown): Entity | null => {
  if (typeof id !== 'number') return null;
  const e = ctx.state.entities[String(id)];
  return e?.c.item?.carriedBy === ctx.state.playerId ? e : null;
};

function itemArg(action: PlayerAction): unknown {
  return action.type === 'mod' ? (action.args as { item?: unknown } | undefined)?.item : undefined;
}

const DIRECTION_OPTIONS: PromptOption[] = DIR_LIST.map((d) => ({ value: d, key: `dir.${d}` }));

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
