// Eating: the eat action, meals that take several turns, choking, rotten food and corpses.
// ref: src/eat.c doeat(), start_eating(), eatfood(), done_eating(), bite(), choke(),
// rottenfood(), eatcorpse(), cprefx()/cpostfx(), fprefx()/fpostfx()
import {
  NORMAL_SPEED,
  getPlayer,
  itemsAt,
  type ActionDef,
  type Ctx,
  type Entity,
  type EntityId,
  type Msg,
  type ModApi,
  type ObjectDef,
  type Offer,
  type PlayerAction,
} from '@nh/core';
import {
  hungerData,
  isHelpless,
  isSick,
  lesshungry,
  makeSick,
  makeVomiting,
  morehungry,
  newuhs,
  nomulNow,
  vomit,
  type Victual,
} from './hunger';
import { cpostfxOf } from './givit';
import { die, losehp, losestr } from './hp';
import { gainExperience } from './hero';
import { P, hasProp } from './props';
import { addToInventory, nhData, placeOnFloor, splitStack } from './items';
import { encumberMsg } from './itemactions';
import { xnameOf } from './objnam';

// ---------------------------------------------------------------------------------------------
// helpers

const hero = (ctx: Ctx): Entity => getPlayer(ctx.state);
const say = (ctx: Ctx, key: string, params?: Record<string, Msg | string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

function itemArg(action: PlayerAction): number | undefined {
  if (action.type !== 'mod') return undefined;
  const a = action.args as { item?: unknown } | undefined;
  return typeof a?.item === 'number' ? a.item : undefined;
}

/** The food's singular name without article ("food ration", "newt corpse"). ref: food_xname() */
function foodName(ctx: Ctx, e: Entity): Msg {
  const it = e.c.item;
  if (!it || it.quantity === 1) return xnameOf(ctx.state, ctx.defs, e);
  return xnameOf(ctx.state, ctx.defs, { ...e, c: { ...e.c, item: { ...it, quantity: 1 } } });
}

const isCorpse = (e: Entity): boolean => e.def === 'nh:corpse';

/** Whether the item is carried by the hero or lies on her square. */
function reachable(ctx: Ctx, e: Entity): boolean {
  const it = e.c.item;
  if (!it) return false;
  if (it.carriedBy !== null) return it.carriedBy === ctx.state.playerId;
  const hp = hero(ctx).c.pos;
  const p = e.c.pos;
  return !!hp && !!p && p.level === hp.level && p.x === hp.x && p.y === hp.y;
}

/** ref: src/eat.c obj_nutrition() (no lembas/cram race adjustments: the hero is human) */
function objNutrition(ctx: Ctx, e: Entity): number {
  const it = e.c.item;
  if (isCorpse(e) && it?.corpseOf && ctx.defs.isMonster(it.corpseOf))
    return ctx.defs.monster(it.corpseOf).nutrition;
  return ctx.defs.object(e.def).food?.nutrition ?? 0;
}

/** ref: include/hack.h nonrotting_food() */
const nonrottingFood = (def: ObjectDef): boolean =>
  def.id === 'nh:lembas_wafer' || def.id === 'nh:cram_ration';

/** ref: src/hack.c rounddiv() for non-negative arguments */
function rounddiv(x: number, y: number): number {
  const r = Math.trunc(x / y);
  return 2 * (x % y) >= y ? r + 1 : r;
}

/** Uses up one of the item (a stack of one is removed). ref: useup() / useupf() */
function useup(ctx: Ctx, e: Entity): void {
  const it = e.c.item;
  if (it && it.quantity > 1) it.quantity -= 1;
  else ctx.remove(e.id);
}

export { losehp };

// ---------------------------------------------------------------------------------------------
// the meal

function victualOf(ctx: Ctx): Victual | null {
  return hungerData(ctx).victual;
}

/** ref: src/eat.c do_reset_eat() / reset_eat() */
function resetEat(ctx: Ctx): void {
  hungerData(ctx).victual = null;
}

/**
 * Reduces the piece's nutrition left (`oeaten`): amt > 0 halves it that many times, amt < 0
 * subtracts. It never reaches 0. ref: src/eat.c consume_oeaten()
 */
function consumeOeaten(ctx: Ctx, e: Entity, amt: number): void {
  const it = e.c.item;
  if (!it || !objNutrition(ctx, e)) return;
  const v = victualOf(ctx);
  it.eaten ??= objNutrition(ctx, e);
  if (amt > 0) it.eaten >>= amt;
  else if (it.eaten > -amt) it.eaten += amt;
  else it.eaten = 0;
  if (it.eaten === 0) {
    if (v && v.piece === e.id) v.reqtime = v.usedtime;
    it.eaten = 1;
  }
}

/**
 * Marks the item partly eaten and splits one off a stack. Returns the single piece being eaten.
 * ref: src/eat.c touchfood()
 */
function touchfood(ctx: Ctx, e: Entity): Entity {
  const it = e.c.item;
  if (!it) return e;
  let piece = e;
  if (it.quantity > 1) {
    const childId = splitStack(ctx, e.id, 1);
    const child = ctx.state.entities[String(childId)];
    if (child?.c.item) {
      child.c.item.eaten = child.c.item.eaten || objNutrition(ctx, child);
      const carried = it.carriedBy;
      const placed =
        carried !== null
          ? addToInventory(ctx, carried, childId)
          : (() => {
              const p = e.c.pos;
              return p ? placeOnFloor(ctx, childId, p.level, p.x, p.y) : childId;
            })();
      piece = ctx.state.entities[String(placed)] ?? child;
    }
  } else if (!it.eaten) {
    it.eaten = objNutrition(ctx, e);
  }
  return piece;
}

/** ref: src/eat.c adj_victual_nutrition() (no race adjustments for a human) */
function adjVictualNutrition(v: Victual): number {
  return Math.max(-v.nmod, 1);
}

/** ref: src/eat.c choke() for a satiated hero eating `food` */
function choke(ctx: Ctx, food: Entity | null): void {
  const h = hero(ctx);
  if (h.c.hunger?.state !== 'satiated') return;
  if (ctx.rng.rn2(20) === 0) {
    // You stuff yourself and then vomit voluminously.
    say(ctx, 'eat.stuff');
    morehungry(ctx, 1000); // just got very sick!
    vomit(ctx);
    return;
  }
  const killer = food ? `@killer.choked.${food.def}` : '@killer.choked.snack';
  if (food) say(ctx, 'eat.choke_over', { item: foodName(ctx, food) });
  else say(ctx, 'eat.choke_over_it');
  die(ctx, killer);
}

/**
 * Takes one bite: checks for choking and gives this bite's nutrition. Returns true if the hero
 * choked and survived. ref: src/eat.c bite()
 */
function bite(ctx: Ctx): boolean {
  const v = victualOf(ctx);
  const piece = v ? ctx.state.entities[String(v.piece)] : undefined;
  if (!v || !piece) return false;
  const choker = (c: Ctx): void => choke(c, piece);
  if (v.canchoke && (hero(ctx).c.hunger?.nutrition ?? 0) >= 2000) {
    choke(ctx, piece);
    return true;
  }
  if (v.nmod < 0) {
    lesshungry(ctx, adjVictualNutrition(v), true, (c) => {
      choker(c);
      resetEat(c);
    });
    consumeOeaten(ctx, piece, v.nmod);
  } else if (v.nmod > 0 && v.usedtime % v.nmod) {
    lesshungry(ctx, 1, true, (c) => {
      choker(c);
      resetEat(c);
    });
    consumeOeaten(ctx, piece, -1);
  }
  return false;
}

/** ref: src/eat.c done_eating() */
function doneEating(ctx: Ctx, message: boolean): void {
  const v = victualOf(ctx);
  const piece = v ? ctx.state.entities[String(v.piece)] : undefined;
  if (!v || !piece) {
    resetEat(ctx);
    return;
  }
  v.eating = false; // do this early, so newuhs() knows we're done
  newuhs(ctx, false);
  const data = nhData(ctx);
  if (data.nomovemsg) {
    if (message) say(ctx, data.nomovemsg.key, data.nomovemsg.params);
    data.nomovemsg = null;
  } else if (message) {
    say(ctx, 'eat.finish', { item: foodName(ctx, piece) });
  }
  const carried = piece.c.item?.carriedBy === ctx.state.playerId;
  if (isCorpse(piece)) cpostfx(ctx, piece);
  else fpostfx(ctx, piece);
  useup(ctx, piece);
  resetEat(ctx);
  if (carried) encumberMsg(ctx);
}

/** Called each move while eating. ref: src/eat.c eatfood() */
function eatfood(ctx: Ctx): number {
  const v = victualOf(ctx);
  const piece = v ? ctx.state.entities[String(v.piece)] : undefined;
  if (!v || !piece || !reachable(ctx, piece)) {
    resetEat(ctx);
    return 0;
  }
  v.pending = false;
  if (!v.eating) return 0;
  if (++v.usedtime <= v.reqtime) {
    if (bite(ctx)) v.eating = false;
    return NORMAL_SPEED;
  }
  doneEating(ctx, true);
  return NORMAL_SPEED;
}

/**
 * Stops what the hero is doing because something happened (a monster attacked). If she is
 * eating, says so and leaves the partly eaten food. ref: src/allmain.c stop_occupation()
 */
export function stopOccupation(ctx: Ctx): void {
  ctx.interrupt();
  interruptMeal(ctx);
}

/** The meal part of stop_occupation(): "You stop eating the X." and the food stays partly eaten. */
function interruptMeal(ctx: Ctx): void {
  const v = victualOf(ctx);
  if (!v || !v.eating) return;
  v.eating = false;
  v.pending = false;
  const piece = ctx.state.entities[String(v.piece)];
  if (!piece) return;
  // ref: src/eat.c maybe_finished_meal(): the last bite may already be gone
  if (v.usedtime >= v.reqtime) {
    v.eating = true;
    eatfood(ctx);
    return;
  }
  say(ctx, 'eat.stop', { item: foodName(ctx, piece) });
}

/**
 * The engine drops `state.occupation` when any other action arrives (input cancels a meal) and
 * also when something interrupted it. The meal itself lives in mod data, so before the next
 * action that is not the meal's own `continue` we notice a meal still marked in progress and stop
 * it like stop_occupation() does. A `continue` carries occupation data set by `continues`.
 */
export function registerEat(api: ModApi): void {
  api.on('beforeAction', (ctx) => {
    const v = victualOf(ctx);
    if (v?.eating && v.pending && ctx.state.occupation?.data == null) interruptMeal(ctx);
    return 'continue';
  });
}

/** A visible hostile monster next to the hero. ref: src/hack.c monster_nearby() */
function monsterNearby(ctx: Ctx): boolean {
  const pos = hero(ctx).c.pos;
  if (!pos) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      for (const m of ctx.query.describe({ x: pos.x + dx, y: pos.y + dy }).entities) {
        const mon = ctx.state.entities[String(m.id)]?.c.monster;
        if (mon && !mon.peaceful && !mon.asleep) return true;
      }
    }
  return false;
}

// ---------------------------------------------------------------------------------------------
// rotten food

/** ref: src/eat.c rottenfood(): returns true if the hero passed out */
function rottenfood(ctx: Ctx, e: Entity): boolean {
  const def = ctx.defs.object(e.def);
  const rottable = !nonrottingFood(def);
  say(ctx, rottable ? 'eat.rotten' : 'eat.awful');
  const roll = (n: number): boolean => ctx.rng.rn2(n) === 0;
  const rollAgain = roll; // a second, separate 1 in 4 roll
  if (roll(4)) {
    // Confusion does not exist yet: the duration is rolled (d(2, 4)) but has no effect.
    say(ctx, 'eat.light_headed');
    ctx.rng.d(2, 4);
  } else if (rollAgain(4)) {
    // Blindness does not exist yet either (d(2, 10)).
    say(ctx, 'eat.goes_dark');
    ctx.rng.d(2, 10);
  } else if (roll(3)) {
    const duration = ctx.rng.rnd(10);
    say(ctx, 'eat.world_spins');
    nomulNow(ctx, duration, 'helpless.rotten_food', { key: 'eat.conscious_again' });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// corpses

const TASTES = ['okay', 'stringy', 'gamey', 'fatty', 'tough'] as const;

/**
 * Checks a corpse that is about to be eaten. Returns 0 (fine), 1 (the hero passed out; the
 * meal is not started) or 2 (the corpse is used up). ref: src/eat.c eatcorpse()
 * Not ported: petrification, sliming, globs, vegan/vegetarian conduct, cannibalism (no human
 * monsters in the roster), `orotten`, lizards and lichens (not in the roster).
 */
function eatcorpse(ctx: Ctx, e: Entity, v: Victual): number {
  const it = e.c.item;
  if (!it?.corpseOf || !ctx.defs.isMonster(it.corpseOf)) return 0;
  const mon = ctx.defs.monster(it.corpseOf);
  let retcode = 0;
  let tp = 0;
  const age = it.age ?? 0;
  let rotted = Math.trunc((ctx.state.turn - age) / (10 + ctx.rng.rn2(20)));
  if (it.buc === 'cursed') rotted += 2;
  else if (it.buc === 'blessed') rotted -= 2;

  if (rotted > 5) {
    say(ctx, 'eat.tainted');
    // Sick_resistance does not exist
    let sickTime = 10 + ctx.rng.rn2(10); // rn1(10, 10)
    const old = hungerData(ctx).sick?.remaining ?? 0;
    // make sure new ill doesn't result in improvement
    if (old > 0 && sickTime > old) sickTime = old > 1 ? old - 1 : 1;
    makeSick(ctx, sickTime, `@killer.rotted.${mon.id}`, true);
    say(ctx, 'eat.tainted_note');
    useup(ctx, e);
    return 2;
  } else if (mon.flags.includes('acid') && !hasProp(hero(ctx), P.ACID_RES)) {
    tp++;
    say(ctx, 'eat.acid');
    losehp(ctx, ctx.rng.rnd(15), '@killer.acidic_corpse');
  } else if (mon.flags.includes('pois') && ctx.rng.rn2(5) !== 0) {
    tp++;
    say(ctx, 'eat.poisonous');
    if (!hasProp(hero(ctx), P.POISON_RES)) {
      // poison_strdmg(rnd(4), rnd(15), ...)
      const strloss = ctx.rng.rnd(4);
      const dmg = ctx.rng.rnd(15);
      losestr(ctx, strloss, '@killer.poisonous_corpse');
      if (!ctx.state.gameOver) losehp(ctx, dmg, '@killer.poisonous_corpse');
    } else say(ctx, 'eat.poison_unaffected');
  } else if (rotted > 3 && ctx.rng.rn2(5) !== 0) {
    // (the original also tests rotted > 5, which the tainted branch above already took)
    // now any corpse left too long will make you mildly ill
    tp++;
    say(ctx, isSick(ctx) ? 'eat.feel_very_sick' : 'eat.feel_sick');
    losehp(ctx, ctx.rng.rnd(8), '@killer.cadaver');
  }
  if (ctx.state.gameOver) return 2;

  // delay is weight dependent
  v.reqtime = 3 + (mon.weight >> 6);

  if (!tp && ctx.rng.rn2(7) === 0) {
    if (rottenfood(ctx, e)) retcode = 1;
    if (!mon.nutrition) {
      // no nutrition: rots away, no message if you passed out
      if (!retcode) say(ctx, 'eat.rots_away_completely');
      useup(ctx, e);
      retcode = 2;
    }
    if (!retcode) consumeOeaten(ctx, e, 2); // oeaten >>= 2
  } else if (tp) {
    // we've already delivered a message; don't add "it tastes okay"
  } else {
    // The hero is an omnivore: never "delicious"; palatable if not too old.
    const palatable = ctx.rng.rn2(10) !== 0 && (rotted < 1 || ctx.rng.rn2(rotted + 1) === 0);
    const idx = ctx.rng.rn2(TASTES.length); // meat is never vegetarian
    const taste = TASTES[idx] ?? 'okay';
    say(ctx, palatable ? `eat.corpse.${taste}` : 'eat.corpse.terrible', {
      item: foodName(ctx, e),
    });
  }
  return retcode;
}

/**
 * Effects of finishing a corpse: stun from bats and a chance at an intrinsic.
 * ref: src/eat.c cpostfx(), see givit.ts for what is and is not ported.
 */
function cpostfx(ctx: Ctx, corpse: Entity): void {
  const of = corpse.c.item?.corpseOf;
  if (of && ctx.defs.isMonster(of)) cpostfxOf(ctx, ctx.defs.monster(of));
}

/** ref: src/eat.c cprefx(): nothing applies to the roster (no cannibalism, cockatrice, pets). */
function cprefx(_ctx: Ctx, _corpse: Entity): void {
  // intentionally empty for the current roster
}

// ---------------------------------------------------------------------------------------------
// ordinary food

/** Messages on the first bite. ref: src/eat.c fprefx(). Returns false if eating cannot go on. */
function fprefx(ctx: Ctx, e: Entity, v: Victual): boolean {
  const h = hero(ctx);
  const nutrition = h.c.hunger?.nutrition ?? 0;
  const it = e.c.item;
  const cursed = it?.buc === 'cursed';
  const item = foodName(ctx, e);
  switch (e.def) {
    case 'nh:food_ration':
      // 200+800 remains below 1000+1, the satiation threshold
      if (nutrition <= 200) say(ctx, 'eat.hits_spot');
      // 700-1+800 remains below 1500, the choking threshold
      else if (nutrition < 700) say(ctx, 'eat.satiates');
      break;
    case 'nh:tripe_ration':
      // The hero is a human, not a carnivorous non-humanoid or an orc.
      say(ctx, 'eat.tripe_yak');
      gainExperience(ctx, h.id, 1);
      if (ctx.rng.rn2(2) !== 0) makeVomiting(ctx, 14 + ctx.rng.rn2(v.reqtime), false); // rn1(reqtime, 14)
      break;
    case 'nh:lembas_wafer':
    default:
      if (e.def === 'nh:apple' && cursed) {
        // feedback deferred til fpostfx()
      } else if (e.def === 'nh:apple') {
        say(ctx, 'eat.core_dumped');
      } else {
        say(
          ctx,
          cursed ? 'eat.terrible' : e.def === 'nh:cram_ration' ? 'eat.bland' : 'eat.delicious',
          { item },
        );
      }
      break;
  }
  return true;
}

/** Effects of finishing ordinary food. ref: src/eat.c fpostfx() */
function fpostfx(ctx: Ctx, e: Entity): void {
  if (e.def === 'nh:apple' && e.c.item?.buc === 'cursed') {
    // Snow White; no Sleep_resistance
    say(ctx, 'eat.sinister_laughter');
    nomulNow(ctx, 20 + ctx.rng.rn2(11), 'helpless.asleep', { key: 'eat.wake_up' }); // rn1(11, 20)
  }
  // The carrot cures blindness; the other foods here have no after effects.
}

// ---------------------------------------------------------------------------------------------
// starting and resuming

/** Starts or continues eating `piece`. ref: src/eat.c start_eating() */
function startEating(ctx: Ctx, piece: Entity, alreadyPartlyEaten: boolean): void {
  const v = victualOf(ctx);
  if (!v) return;
  v.fullwarn = false;
  v.eating = true;
  if (isCorpse(piece)) cprefx(ctx, piece);
  const data = nhData(ctx);
  const oldNomovemsg = data.nomovemsg ?? null;
  if (bite(ctx)) {
    // survived choking, finish off food that's nearly done
    v.eating = false;
    if (++v.usedtime >= v.reqtime) {
      const saved = data.nomovemsg ?? null;
      if (!oldNomovemsg) data.nomovemsg = null;
      doneEating(ctx, false);
      if (!oldNomovemsg) data.nomovemsg = saved;
    }
    return;
  }
  if (++v.usedtime >= v.reqtime) {
    // print "finish eating" message if they just resumed
    doneEating(ctx, v.reqtime > 1 || alreadyPartlyEaten);
    return;
  }
  // set_occupation(eatfood): v.eating stays true and `continues` keeps the meal going
}

/** ref: src/eat.c doeat() for a food item the hero picked. Returns the energy cost. */
function doeat(ctx: Ctx, e: Entity): number {
  const it = e.c.item;
  const def = ctx.defs.object(e.def);
  if (!it || def.class !== 'food' || !reachable(ctx, e)) return 0;
  const h = hero(ctx);
  const hd = hungerData(ctx);

  // Resuming the meal in progress.
  const cur = hd.victual;
  if (cur && cur.piece === e.id) {
    const oneBiteLeft = cur.usedtime + 1 >= cur.reqtime;
    // If they weren't able to choke, they don't suddenly become able to choke just because
    // they were interrupted.
    if (h.c.hunger?.state !== 'satiated') cur.canchoke = false;
    cur.pending = false;
    say(ctx, oneBiteLeft ? 'eat.resume_last' : 'eat.resume');
    startEating(ctx, e, false);
    return NORMAL_SPEED;
  }

  // nothing in progress - so try to find something.
  const alreadyPartlyEaten = !!it.eaten;
  const piece = touchfood(ctx, e);
  const v: Victual = {
    piece: piece.id,
    usedtime: 0,
    reqtime: 0,
    nmod: 0,
    canchoke: false,
    fullwarn: false,
    eating: false,
    pending: false,
  };
  hd.victual = v;
  let dontStart = false;

  if (isCorpse(piece)) {
    const tmp = eatcorpse(ctx, piece, v);
    if (tmp === 2) {
      resetEat(ctx); // used up
      return NORMAL_SPEED;
    } else if (tmp) dontStart = true;
    // if not used up, eatcorpse sets up reqtime and may modify oeaten
  } else {
    const pit = piece.c.item;
    v.reqtime = def.delay;
    const old = ctx.state.turn - (pit?.age ?? 0) > (pit?.buc === 'blessed' ? 50 : 30);
    if (pit?.buc === 'cursed' || (!nonrottingFood(def) && old && ctx.rng.rn2(7) === 0)) {
      if (rottenfood(ctx, piece)) dontStart = true;
      consumeOeaten(ctx, piece, 1); // oeaten >>= 1
    } else if (!alreadyPartlyEaten) {
      if (!fprefx(ctx, piece, v)) {
        resetEat(ctx);
        return NORMAL_SPEED;
      }
    } else {
      say(ctx, v.reqtime === 1 ? 'eat.eat_now' : 'eat.begin', {
        item: ctx.defs.itemName(ctx.state, piece),
      });
    }
  }

  // re-calc the nutrition
  const basenutrit = objNutrition(ctx, piece);
  const oeaten = piece.c.item?.eaten ?? basenutrit;
  v.reqtime = basenutrit === 0 ? 0 : rounddiv(v.reqtime * oeaten, basenutrit);
  // the nutrition per bite (not exact: a little is lost to the division)
  if (v.reqtime === 0 || oeaten === 0) v.nmod = 0;
  else if (oeaten >= v.reqtime) v.nmod = -Math.trunc(oeaten / v.reqtime);
  else v.nmod = v.reqtime % oeaten;
  v.canchoke = h.c.hunger?.state === 'satiated';

  if (!dontStart && !ctx.state.gameOver) startEating(ctx, piece, alreadyPartlyEaten);
  return NORMAL_SPEED;
}

// ---------------------------------------------------------------------------------------------
// the action

const eatOffer = (id: EntityId, labelKey: string, params?: Offer['params']): Offer => ({
  action: { type: 'mod', action: 'nh:eat', args: { item: id } },
  labelKey,
  ...(params ? { params } : {}),
});

const eat: ActionDef = {
  id: 'nh:eat',
  labelKey: 'action.nh:eat',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind === 'item') {
      const e = ctx.state.entities[String(target.id)];
      if (!e?.c.item || e.c.item.carriedBy !== ctx.state.playerId) return [];
      return ctx.defs.object(e.def).class === 'food' ? [eatOffer(e.id, 'action.nh:eat')] : [];
    }
    if (target.kind !== 'self') return [];
    const pos = hero(ctx).c.pos;
    if (!pos) return [];
    // "There is a X here; eat it?": one offer per food item on the floor
    return itemsAt(ctx.defs, ctx.state, pos.level, pos.x, pos.y)
      .filter((e) => ctx.defs.object(e.def).class === 'food')
      .map((e) => eatOffer(e.id, 'action.nh:eat_here', { item: ctx.defs.itemName(ctx.state, e) }));
  },
  perform(ctx, action) {
    const v = victualOf(ctx);
    // a `continue` move of the meal in progress (the engine keeps occupation.data non-null)
    if (v?.pending && ctx.state.occupation?.data != null) return eatfood(ctx);
    const id = itemArg(action);
    if (id === undefined) return 0;
    const e = ctx.state.entities[String(id)];
    if (!e) return 0;
    return doeat(ctx, e);
  },
  continues(ctx) {
    const v = victualOf(ctx);
    if (!v || !v.eating || ctx.state.gameOver || isHelpless(ctx)) return false;
    // ref: src/allmain.c interrupt_occupation: a hostile monster next to the hero stops her
    if (monsterNearby(ctx)) {
      stopOccupation(ctx);
      return false;
    }
    v.pending = true;
    if (ctx.state.occupation) ctx.state.occupation.data = { meal: true };
    return true;
  },
};

export const EAT_ACTIONS: readonly ActionDef[] = [eat];
