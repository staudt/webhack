// Kicking. ref: src/dokick.c dokick(), kick_monster(), kickdmg(), kick_object(),
// really_kick_object(), kick_door(), kick_nondoor(), kick_dumb(), kick_ouch(); src/zap.c bhit()
// (KICKED_WEAPON); src/do.c set_wounded_legs()
//
// The hero is a human Valkyrie: no martial arts, no kicking boots, never polymorphed, not
// levitating, not riding, not swimming. Those branches are not ported. Also not ported: traps, boxes
// and chests, boulders, shops and town watchmen, thrones, altars, fountains, graves, trees, sinks,
// iron bars, pools, ice and greased objects, the exercise of attributes, Luck, alignment, the
// bulky-armor clumsiness and the bad-Dex ATEMP penalty of wounded legs.
import {
  DIRS,
  DIR_LIST,
  NORMAL_SPEED,
  cellIndex,
  cellRules,
  getLevel,
  getPlayer,
  inBounds,
  inventoryOf,
  itemsAt,
  rnl,
  shownId,
  sortedIds,
  isVisible,
  type ActionDef,
  type Ctx,
  type DefId,
  type Dir,
  type Entity,
  type EntityId,
  type Json,
  type ModApi,
  type Msg,
  type MonsterDef,
  type Offer,
  type PlayerAction,
  type Pos,
  type PromptOption,
  type TerrainDef,
} from '@nh/core';
import { setTerrain } from './actions';
import { monsterIdAt } from './combat';
import { confdir } from './hackmove';
import { experienceFor, gainExperience } from './hero';
import { gethungry } from './hunger';
import { losehp } from './hp';
import { nhData, placeOnFloor, splitStack, weight } from './items';
import { clearPath } from './monmove';
import { monsterDied } from './mondeath';
import { heroSees } from './mongear';
import { encumberMsg } from './itemactions';
import { needsAttackConfirm, askReallyAttack, setmangry, wakeup } from './peaceful';
import { passive, type PassiveTarget } from './uhitm_passive';
import { P, hasProp, setItimeout, timeoutLeft } from './props';
import { acurrstr, invWeight, nearCapacity, weightCap } from './stats';
import { T } from './terrain';
import { thitmonst } from './dothrow';

export const KICK_ID: DefId = 'nh:kick';

const say = (ctx: Ctx, key: string, params?: Record<string, Msg | string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

const DIRECTION_OPTIONS: PromptOption[] = DIR_LIST.map((d) => ({ value: d, key: `dir.${d}` }));

/** ref: include/hack.h SLT_ENCUMBER (Burdened); `near_capacity() > SLT_ENCUMBER` is Stressed+ */
const SLT_ENCUMBER = 1;

const hero = (ctx: Ctx): Entity => getPlayer(ctx.state);
const attr = (ctx: Ctx) => {
  const a = hero(ctx).c.attributes;
  return { str: a?.str ?? 10, dex: a?.dex ?? 10, con: a?.con ?? 10 };
};

// ---------------------------------------------------------------------------------------------
// small effects

/**
 * Wakes the monsters near a place without angering them.
 * ref: src/mon.c wake_nearto_core(): `dist2 < distance` sets msleeping = 0 (wake_msg() says so)
 */
function wakeNearto(ctx: Ctx, x: number, y: number, distance: number): void {
  for (const id of sortedIds(ctx.state)) {
    const e = ctx.state.entities[String(id)];
    const m = e?.c.monster;
    const p = e?.c.pos;
    if (!e || !m || !p || p.level !== ctx.state.currentLevel) continue;
    if ((p.x - x) ** 2 + (p.y - y) ** 2 >= distance) continue;
    if (m.asleep && heroSees(ctx, p)) say(ctx, 'mon.wakes_up_calm', { mon: `@${e.def}` });
    m.asleep = false;
  }
}

/** ref: src/do.c set_wounded_legs(): the right leg, `timex` turns (the Dex penalty is not ported) */
export function setWoundedLegs(ctx: Ctx, timex: number): void {
  const h = hero(ctx);
  if (!hasProp(h, P.WOUNDED_LEGS) || timeoutLeft(ctx.state, h, P.WOUNDED_LEGS) < timex)
    setItimeout(ctx.state, h, P.WOUNDED_LEGS, timex);
  (nhData(ctx) as unknown as { legsHurt?: boolean }).legsHurt = true;
  encumberMsg(ctx); // Wounded_legs reduces carrying capacity
}

/** ref: src/dokick.c kickstr(): the cause of death */
const killerFor = (what: string): string => `@killer.kick.${what}`;

/**
 * ref: src/dokick.c kick_ouch(): "Ouch! That hurts!", the noise wakes the neighbours, 1 time in 3
 * the leg is hurt, and d3 (d5 with Con 15 or less) damage.
 */
function kickOuch(ctx: Ctx, x: number, y: number, what: string): void {
  say(ctx, 'kick.ouch');
  const level = getLevel(ctx.state);
  if (inBounds(level, x, y)) wakeNearto(ctx, x, y, 5 * 5);
  if (ctx.rng.rn2(3) === 0) setWoundedLegs(ctx, 5 + ctx.rng.rnd(5));
  const dmg = ctx.rng.rnd(attr(ctx).con > 15 ? 3 : 5);
  losehp(ctx, dmg, killerFor(what));
}

/**
 * ref: src/dokick.c kick_dumb(): "You kick at empty space", or (Dex under 16, 1 in 3) "Dumb move!
 * You strain a muscle." and the leg is hurt for 5 + d5 turns.
 */
function kickDumb(ctx: Ctx): void {
  if (attr(ctx).dex >= 16 || ctx.rng.rn2(3) !== 0) {
    say(ctx, 'kick.empty_space');
  } else {
    say(ctx, 'kick.dumb_move');
    setWoundedLegs(ctx, 5 + ctx.rng.rnd(5));
  }
}

// ---------------------------------------------------------------------------------------------
// doors and other terrain

const terrainAt = (ctx: Ctx, x: number, y: number): TerrainDef => {
  const level = getLevel(ctx.state);
  const id = level.palette[level.cells[cellIndex(level, x, y)] ?? 0];
  if (id === undefined) throw new Error('Unknown terrain');
  return ctx.defs.terrain(id);
};

/**
 * ref: src/dokick.c kick_door(). An open door or a doorway is kicked at "empty space". A closed
 * or locked door gives way when `rnl(35) < (Str + Dex + Con) / 3`: with Str over 18 one time in 5
 * it shatters, otherwise it crashes open; both leave a doorway here (D_NODOOR and D_BROKEN are
 * the same square). Otherwise "Thwack!!" (1 in 3) or "Whammm!!". Not ported: trapped doors, shop
 * doors and the Watch, Levitation.
 */
function kickDoor(ctx: Ctx, x: number, y: number, avrg: number): void {
  const t = terrainAt(ctx, x, y);
  if (t.door !== 'closed' && t.door !== 'locked') {
    kickDumb(ctx);
    return; // uses a turn
  }
  if (rnl(ctx.rng, 35) < avrg) {
    const level = getLevel(ctx.state);
    if (attr(ctx).str > 18 && ctx.rng.rn2(5) === 0) say(ctx, 'kick.door_shatters');
    else say(ctx, 'kick.door_crashes');
    setTerrain(level, x, y, T.doorway);
    ctx.emit({ type: 'doorOpened', pos: { x, y } });
  } else {
    say(ctx, ctx.rng.rn2(3) === 0 ? 'kick.door_thwack' : 'kick.door_whammm');
  }
}

/**
 * ref: src/dokick.c kick_nondoor(): secret doors and corridors open up with `rn2(30) < avrg`
 * ("Crash!"), walls and rock hurt, the up stairs hurt and the down stairs are "dumb", and
 * anything else is empty space.
 */
function kickNondoor(ctx: Ctx, x: number, y: number, avrg: number): void {
  const level = getLevel(ctx.state);
  const id = level.palette[level.cells[cellIndex(level, x, y)] ?? 0];
  const secretDoor =
    id === T.sdoor_v || id === T.sdoor_h || id === T.sdoor_locked_v || id === T.sdoor_locked_h;
  if (secretDoor) {
    if (ctx.rng.rn2(30) < avrg) {
      const locked = id === T.sdoor_locked_v || id === T.sdoor_locked_h;
      const vertical = id === T.sdoor_v || id === T.sdoor_locked_v;
      // cvt_sdoor_to_door(): a locked one is uncovered (still locked), a closed one kicked open
      say(ctx, locked ? 'kick.uncovers_door' : 'kick.kicks_open_door');
      setTerrain(level, x, y, locked ? T.door_locked : vertical ? T.door_open_v : T.door_open_h);
    } else kickOuch(ctx, x, y, 'wall');
    return;
  }
  if (id === T.scorr) {
    if (ctx.rng.rn2(30) < avrg) {
      say(ctx, 'kick.kicks_open_passage');
      setTerrain(level, x, y, T.corr);
    } else kickOuch(ctx, x, y, 'rock');
    return;
  }
  const t = terrainAt(ctx, x, y);
  if (t.stairs === 'down') kickDumb(ctx);
  else if (t.stairs === 'up') kickOuch(ctx, x, y, 'stairs');
  else if (!t.passable && t.door === undefined)
    kickOuch(ctx, x, y, t.id === 'nh:stone' ? 'rock' : 'wall');
  else kickDumb(ctx);
}

// ---------------------------------------------------------------------------------------------
// objects

/** The weight of one object of a stack. ref: src/dokick.c really_kick_object() k_owt */
function unitWeight(ctx: Ctx, e: Entity): number {
  const it = e.c.item;
  if (!it || it.quantity <= 1) return weight(ctx.defs, e);
  return weight(ctx.defs, { ...e, c: { ...e.c, item: { ...it, quantity: 1 } } });
}

/** ref: src/dothrow.c breaktest(): potions and glass (but not gems) break; eggs and such do not exist */
function fragile(ctx: Ctx, e: Entity): boolean {
  const od = ctx.defs.object(e.def);
  return od.class === 'potion' || (od.material === 'glass' && od.class !== 'gem');
}

/**
 * Flies the (detached) object `dist` squares from the cell (x, y) in direction `dir`; it stops
 * before a wall or closed door, on a monster, and a coin stops on a square that holds objects.
 * ref: src/zap.c bhit() with KICKED_WEAPON: "object starts one square in front of player"
 */
function bhitKicked(
  ctx: Ctx,
  objId: EntityId,
  from: Pos,
  dir: Dir,
  range: number,
): { pos: Pos; mon: EntityId | null } {
  const level = getLevel(ctx.state);
  const rules = cellRules(level, ctx.defs);
  const obj = ctx.state.entities[String(objId)];
  const coin = obj !== undefined && ctx.defs.object(obj.def).class === 'coin';
  const d = DIRS[dir];
  let x = from.x;
  let y = from.y;
  let mon: EntityId | null = null;
  const path: Pos[] = [];
  range--;
  while (range-- > 0) {
    x += d.x;
    y += d.y;
    if (!inBounds(level, x, y)) {
      x -= d.x;
      y -= d.y;
      break;
    }
    if (!rules.passable[level.cells[cellIndex(level, x, y)] ?? 0]) {
      x -= d.x;
      y -= d.y;
      break;
    }
    if (isVisible(ctx.state, cellIndex(level, x, y))) path.push({ x, y });
    const m = monsterIdAt(ctx, { x, y }, level.id);
    if (m !== null) {
      mon = m;
      break;
    }
    if (coin && itemsAt(ctx.defs, ctx.state, level.id, x, y).length > 0) break;
  }
  if (path.length > 0 && obj)
    ctx.emit({ type: 'projectile', g: shownId(ctx.state, obj.def), path });
  return { pos: { x, y }, mon };
}

/**
 * Kicks the top object of the pile; false means nothing came of it (then the hero hurts herself).
 * ref: src/dokick.c really_kick_object(). The range is `Str / 2 - weight / 40`; it is 1 when the
 * next square is a wall or closed door. A range under 2 is "Thump!" (and a bruise 2 times in 3).
 * Potions and glass shatter. A single coin stack scatters its coins ("Thwwpingg!") 19 times in 20
 * without moving anything; a kicked stack sends one object. The object flies and hits a monster
 * with thitmonst().
 */
function reallyKickObject(ctx: Ctx, pile: Entity, x: number, y: number, dir: Dir): boolean {
  const it = pile.c.item;
  const pos = hero(ctx).c.pos;
  if (!it || !pos) return false;
  const level = getLevel(ctx.state);
  const od = ctx.defs.object(pile.def);
  const isgold = od.class === 'coin';
  const d = DIRS[dir];

  let range = Math.trunc(acurrstr(attr(ctx).str) / 2) - Math.trunc(unitWeight(ctx, pile) / 40);
  // the object has no place to move into
  const nx = x + d.x;
  const ny = y + d.y;
  const rules = cellRules(level, ctx.defs);
  if (!inBounds(level, nx, ny) || !rules.passable[level.cells[cellIndex(level, nx, ny)] ?? 0])
    range = 1;

  // "You kick a dagger." (one of the stack)
  const one = it.quantity > 1 && !isgold ? { ...pile, c: { ...pile.c, item: { ...it, quantity: 1 } } } : pile;
  say(ctx, 'kick.you_kick_obj', { item: ctx.defs.itemName(ctx.state, one) });

  // ref: hero_breaks(): fragile objects should not be kicked
  if (fragile(ctx, pile)) {
    say(ctx, it.quantity === 1 ? 'kick.shatters' : 'kick.shatter', {
      item: ctx.defs.itemName(ctx.state, pile),
    });
    ctx.remove(pile.id);
    return true;
  }

  // too heavy to move
  if (range < 2) {
    say(ctx, 'kick.thump');
    return ctx.rng.rn2(3) === 0;
  }

  let id = pile.id;
  if (it.quantity > 1) {
    if (!isgold) {
      id = splitStack(ctx, pile.id, 1);
    } else if (ctx.rng.rn2(20) !== 0) {
      // coins scatter (the scatter() flight of each coin is not ported: they stay where they are)
      say(ctx, 'kick.coins_scatter');
      ctx.rng.rnd(3);
      return true;
    } else if (it.quantity > 300) {
      say(ctx, 'kick.thump');
      return ctx.rng.rn2(3) === 0;
    }
  }
  const obj = ctx.state.entities[String(id)];
  if (!obj) return false;
  delete obj.c.pos; // obj_extract_self()

  const { pos: land, mon } = bhitKicked(ctx, id, { x, y }, dir, range);
  if (mon !== null) {
    if (isgold) {
      // ref: dokick.c ghitm(): a monster that does not want gold is woken (and angered) by the
      // blow; greedy monsters catching it are not ported
      wakeup(ctx, mon);
    } else if (thitmonst(ctx, mon, id, { i: 1, n: 1 })) {
      return true; // used up
    }
  }
  // the object lands where it stopped (on the monster's square if one was hit, even a dead one)
  if (ctx.state.entities[String(id)]) placeOnFloor(ctx, id, level.id, land.x, land.y);
  return true;
}

// ---------------------------------------------------------------------------------------------
// monsters

/** ref: include/mondata.h bigmonst() */
const bigmonst = (def: MonsterDef): boolean =>
  def.size === 'large' || def.size === 'huge' || def.size === 'gigantic';

/** ref: include/mondata.h thick_skinned(): M1_THICK_HIDE */
const thickSkinned = (def: MonsterDef): boolean => def.flags.includes('thick_hide');

/**
 * A monster that dodges the kick moves next to the hero. ref: src/mon.c maybe_mnexto() (enexto():
 * the nearest free squares around the hero, a random one of the first ring that has any; it must
 * be in her line of sight, and a grid bug not diagonal to where it was). May leave it in place.
 */
function maybeMnexto(ctx: Ctx, monId: EntityId): void {
  const mon = ctx.state.entities[String(monId)];
  const hp = hero(ctx).c.pos;
  const mp = mon?.c.pos;
  if (!mon || !hp || !mp) return;
  const level = getLevel(ctx.state);
  const rules = cellRules(level, ctx.defs);
  const diagok = mon.def !== 'nh:grid_bug';
  // enexto(): the free squares of the first ring around the hero that has any
  const ring: Pos[] = [];
  for (let r = 1; r < 8 && ring.length === 0; r++) {
    for (let xx = hp.x - r; xx <= hp.x + r; xx++) {
      for (let yy = hp.y - r; yy <= hp.y + r; yy++) {
        if (Math.max(Math.abs(xx - hp.x), Math.abs(yy - hp.y)) !== r) continue;
        if (!inBounds(level, xx, yy)) continue;
        if (!rules.passable[level.cells[cellIndex(level, xx, yy)] ?? 0]) continue;
        const there = monsterIdAt(ctx, { x: xx, y: yy }, level.id);
        if (there === null || there === monId) ring.push({ x: xx, y: yy });
      }
    }
  }
  let tries = 20;
  while (ring.length > 0 && tries-- > 0) {
    const cand = ring[ctx.rng.rn2(ring.length)];
    if (
      cand &&
      clearPath(level, rules.opaque, hp.x, hp.y, cand.x, cand.y) &&
      (diagok || cand.x === mp.x || cand.y === mp.y)
    ) {
      if (cand.x !== mp.x || cand.y !== mp.y) {
        const from = { x: mp.x, y: mp.y };
        mp.x = cand.x;
        mp.y = cand.y;
        ctx.emit({ type: 'moved', id: monId, from, to: { x: cand.x, y: cand.y } });
      }
      return;
    }
  }
}

/** ref: src/dokick.c kickdmg() for a hero who is not polymorphed and wears no boots */
function kickdmg(ctx: Ctx, monId: EntityId, clumsy: boolean): void {
  const target = ctx.state.entities[String(monId)];
  const mon = target?.c.monster;
  if (!target || !mon || !target.c.pos) return;
  const def = ctx.defs.monster(target.def);
  const a = attr(ctx);
  let dmg = Math.trunc((acurrstr(a.str) + a.dex + a.con) / 15);
  if (clumsy) dmg = Math.trunc(dmg / 2); // excessive weight affects Dex, so it affects damage
  if (thickSkinned(def)) dmg = 0; // kicking a dragon or an elephant will not harm it
  if (dmg > 0) dmg = ctx.rng.rnd(dmg); // martial arts would add rn2(Dex / 2 + 1)
  // boots: `dmg += uarmf->spe`
  const boots = inventoryOf(ctx.state, ctx.state.playerId).find(
    (o) => o.c.item?.equipped === 'boots',
  );
  dmg += boots?.c.item?.spe ?? 0;
  const snap: PassiveTarget = {
    id: monId,
    def,
    level: mon.level,
    pos: { ...target.c.pos },
  };
  const hp = target.c.hp;
  if (dmg > 0 && hp) hp.cur -= dmg;
  const dead = !hp || hp.cur < 1;
  // ref: passive(mon, uarmf, TRUE, !DEADMONSTER(mon), AT_KICK, FALSE)
  passive(ctx, snap, true, !dead);
  if (dead) {
    // ref: src/mon.c killed() -> xkilled(): "You kill/destroy it!"
    const nonliving = def.flags.includes('undead') || def.id === 'nh:manes';
    say(ctx, nonliving ? 'combat.you_destroy' : 'combat.you_kill', { mon: `@${target.def}` });
    monsterDied(ctx, monId, true);
    gainExperience(ctx, ctx.state.playerId, experienceFor(def, mon.level));
  }
}

/**
 * ref: src/dokick.c kick_monster(): the monster is angered; a heavily loaded hero may do no damage
 * or kick clumsily; a quick, able monster may block the kick or jump out of the way; otherwise
 * kickdmg(). (There is no to-hit roll.)
 */
function kickMonster(ctx: Ctx, monId: EntityId, x: number, y: number): void {
  const target = ctx.state.entities[String(monId)];
  const mon = target?.c.monster;
  if (!target || !mon) return;
  const def = ctx.defs.monster(target.def);
  const name = `@${target.def}`;
  const snap: PassiveTarget | null = target.c.pos
    ? { id: monId, def, level: mon.level, pos: { ...target.c.pos } }
    : null;
  const passiveMiss = (): void => {
    if (snap) passive(ctx, snap, false, true);
  };
  // anger target even if wild miss will occur
  setmangry(ctx, monId);

  // ref: "What the following confusing if statements mean": over 70% of capacity
  const i = -invWeight(ctx.state, ctx.defs, ctx.state.playerId);
  const j = weightCap(ctx.state, ctx.state.playerId);
  let clumsy = false;
  if (i < Math.trunc((j * 3) / 10)) {
    if (ctx.rng.rn2(i < Math.trunc(j / 10) ? 2 : i < Math.trunc(j / 5) ? 3 : 4) === 0) {
      say(ctx, 'kick.clumsy_no_damage');
      passiveMiss();
      return;
    }
    if (i < Math.trunc(j / 10)) clumsy = true;
    else if (ctx.rng.rn2(i < Math.trunc(j / 5) ? 2 : 3) === 0) clumsy = true;
  }
  // (Fumbling and bulky body armor would also make the kick clumsy: not ported)

  say(ctx, 'kick.you_kick_mon', { mon: name });
  if (
    ctx.rng.rn2(clumsy ? 3 : 4) === 0 &&
    (clumsy || !bigmonst(def)) &&
    !thickSkinned(def) &&
    !def.flags.includes('noeyes') &&
    !mon.asleep &&
    def.speed >= 12
  ) {
    if (!def.flags.includes('nohands') && ctx.rng.rn2(3) === 0) {
      say(ctx, clumsy ? 'kick.blocks_clumsy' : 'kick.blocks', { mon: name });
      passiveMiss();
      return;
    }
    maybeMnexto(ctx, monId);
    const at = ctx.state.entities[String(monId)]?.c.pos;
    if (at && (at.x !== x || at.y !== y)) {
      const verb = def.flags.includes('fly')
        ? 'swoops'
        : def.flags.includes('nolimbs')
          ? 'slides'
          : 'jumps';
      say(ctx, 'kick.evades', {
        mon: name,
        verb: { key: `kick.verb.${verb}` },
        how: { key: clumsy ? 'kick.easily' : 'kick.nimbly' },
        kick: { key: clumsy ? 'kick.clumsy_kick' : 'kick.kick' },
      });
      passiveMiss();
      return;
    }
  }
  kickdmg(ctx, monId, clumsy);
}

// ---------------------------------------------------------------------------------------------
// the command

/**
 * The checks at the top of dokick(); false means the hero cannot kick (no time passes).
 * ref: src/dokick.c dokick(): wounded legs, `near_capacity() > SLT_ENCUMBER`
 */
function canKick(ctx: Ctx): boolean {
  if (hasProp(hero(ctx), P.WOUNDED_LEGS)) {
    say(ctx, 'kick.legs_no_shape');
    return false;
  }
  if (nearCapacity(ctx.state, ctx.defs, ctx.state.playerId) > SLT_ENCUMBER) {
    say(ctx, 'kick.too_heavy');
    return false;
  }
  return true;
}

/** ref: src/dokick.c dokick() after the direction is known; `confirmed` skips the peaceful query */
function kickDir(ctx: Ctx, dir: Dir, confirmed: boolean): number {
  const pos = hero(ctx).c.pos;
  if (!pos) return 0;
  const level = getLevel(ctx.state, pos.level);
  const d = DIRS[dir];
  const x = pos.x + d.x;
  const y = pos.y + d.y;
  // KMH -- Kicking boots always succeed (not ported)
  const a = attr(ctx);
  const avrg = Math.trunc((acurrstr(a.str) + a.dex + a.con) / 3);

  const mtmp = inBounds(level, x, y) ? monsterIdAt(ctx, { x, y }, pos.level) : null;
  if (mtmp !== null) {
    // ref: maybe_kick_monster(): attack_checks() and overexertion()
    if (!confirmed && needsAttackConfirm(ctx, mtmp)) {
      askReallyAttack(ctx, mtmp, KICK_ID, { step: 'confirm', dir });
      return 0;
    }
    gethungry(ctx);
    if (hero(ctx).c.helpless || ctx.state.gameOver) return NORMAL_SPEED;
  }

  wakeNearto(ctx, pos.x, pos.y, (hero(ctx).c.experience?.level ?? 1) * 20);
  if (!inBounds(level, x, y)) {
    kickOuch(ctx, x, y, 'nothing');
    return NORMAL_SPEED;
  }
  if (mtmp !== null) {
    kickMonster(ctx, mtmp, x, y);
    return NORMAL_SPEED;
  }
  // monsters, pools, objects, non-doors, doors -- in that order
  const pile = itemsAt(ctx.defs, ctx.state, level.id, x, y);
  const top = pile[0];
  if (top) {
    if (!reallyKickObject(ctx, top, x, y, dir)) kickOuch(ctx, x, y, 'object');
    return NORMAL_SPEED;
  }
  if (terrainAt(ctx, x, y).door !== undefined) kickDoor(ctx, x, y, avrg);
  else kickNondoor(ctx, x, y, avrg);
  return NORMAL_SPEED;
}

/** getdir(): a stunned hero kicks in a random direction. ref: src/cmd.c getdir() -> confdir() */
const getdirKick = (ctx: Ctx, dir: Dir): number =>
  kickDir(ctx, hasProp(hero(ctx), P.STUNNED) ? confdir(ctx) : dir, false);

const dirArg = (action: PlayerAction): Dir | null => {
  if (action.type !== 'mod') return null;
  const a = action.args as { dir?: unknown } | undefined;
  return DIR_LIST.find((d) => d === a?.dir) ?? null;
};

// ref: src/dokick.c dokick(), the #kick command (^D)
const kick: ActionDef = {
  id: KICK_ID,
  labelKey: 'action.nh:kick',
  handles: 'mod',
  offer(ctx, target): Offer[] {
    if (target.kind === 'self')
      return [{ action: { type: 'mod', action: KICK_ID }, labelKey: 'action.nh:kick' }];
    if (target.kind !== 'cell') return [];
    const pos = hero(ctx).c.pos;
    if (!pos) return [];
    const dx = target.pos.x - pos.x;
    const dy = target.pos.y - pos.y;
    const dir = DIR_LIST.find((k) => DIRS[k].x === dx && DIRS[k].y === dy);
    if (!dir) return [];
    // a closed (or locked: it looks the same) door the hero knows of
    if (ctx.query.describe(target.pos).terrain !== T.door_closed) return [];
    return [
      {
        action: { type: 'mod', action: KICK_ID, args: { dir } },
        labelKey: 'action.nh:kick_door',
      },
    ];
  },
  perform(ctx, action) {
    if (!canKick(ctx)) return 0;
    const dir = dirArg(action);
    if (dir) return getdirKick(ctx, dir);
    ctx.ask(
      { id: 'kick-direction', kind: 'direction', key: 'kick.direction', options: DIRECTION_OPTIONS },
      KICK_ID,
      { step: 'dir' },
    );
    return 0;
  },
  answer(ctx, value: Json, raw: Json) {
    const step = (raw as { step?: unknown } | null)?.step;
    if (step === 'confirm') {
      const dir = DIR_LIST.find((d) => d === (raw as { dir?: unknown }).dir);
      // declining the query costs nothing (context.move = 0)
      return value === true && dir ? kickDir(ctx, dir, true) : 0;
    }
    const dir = DIR_LIST.find((d) => d === value);
    if (!dir) return 0; // cancelled (ECMD_CANCEL)
    return getdirKick(ctx, dir);
  },
};

export const KICK_ACTIONS: readonly ActionDef[] = [kick];

/** Heals the leg's encumbrance message once the timer has run out (src/do.c heal_legs()). */
export function registerKick(api: ModApi): void {
  api.on('endOfTurn', (ctx) => {
    const d = nhData(ctx) as unknown as { legsHurt?: boolean };
    if (d.legsHurt && !hasProp(hero(ctx), P.WOUNDED_LEGS)) {
      d.legsHurt = false;
      encumberMsg(ctx);
    }
  });
}
