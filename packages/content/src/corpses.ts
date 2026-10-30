// Corpses: when a killed monster leaves one, and how corpses rot away.
// ref: src/mon.c xkilled(), corpse_chance(), make_corpse(); src/mkobj.c start_corpse_timeout()
import { getPlayer, type Ctx, type Json, type ModApi, type MonsterDef } from '@nh/core';
import { hungerData } from './hunger';
import { encumberMsg } from './itemactions';
import { mkcorpse, rne } from './items';
import { xnameOf } from './objnam';

/** ref: include/hack.h ROT_AGE: a corpse rots away at this age (turns) */
export const ROT_AGE = 250;

/** ref: include/mondata.h bigmonst() */
const bigmonst = (def: MonsterDef): boolean =>
  def.size === 'large' || def.size === 'huge' || def.size === 'gigantic';

/** ref: src/rnd.c rnz(): a number around `i`, widely spread, geometric in feel */
export function rnz(ctx: Ctx, i: number): number {
  const lvl = getPlayer(ctx.state).c.experience?.level ?? 1;
  let x = i;
  let tmp = 1000;
  tmp += ctx.rng.rn2(1000);
  tmp *= rne(ctx.rng, 4, lvl);
  if (ctx.rng.rn2(2)) {
    x *= tmp;
    x = Math.trunc(x / 1000);
  } else {
    x *= 1000;
    x = Math.trunc(x / tmp);
  }
  return x;
}

/**
 * Whether a killed monster leaves a corpse. ref: src/mon.c corpse_chance(): big monsters always
 * do, others with chance 1/(2 + (rare) + (tiny)). Not ported: gas spores, liches, golems,
 * player monsters, riders, shopkeepers, cloned monsters.
 */
export function corpseChance(ctx: Ctx, def: MonsterDef): boolean {
  if (bigmonst(def)) return true;
  const tmp = 2 + (def.frequency < 2 ? 1 : 0) + (def.size === 'tiny' ? 1 : 0);
  return ctx.rng.rn2(tmp) === 0;
}

/**
 * Leaves a corpse where the hero killed `def`, if the rules say so, and starts its rot timer.
 * ref: src/mon.c xkilled() ("corpse--none if hero was inside the monster"), make_corpse().
 * Not ported: the 1 in 6 random "treasure drop" (needs random object generation), burying in
 * pits, zombification, revival of trolls.
 */
export function xkilledCorpse(
  ctx: Ctx,
  def: MonsterDef,
  at: { level: string; x: number; y: number },
): void {
  if (def.genFlags.includes('nocorpse')) return; // G_NOCORPSE
  if (!corpseChance(ctx, def)) return;
  const id = mkcorpse(ctx, def, { at });
  startCorpseTimeout(ctx, id);
}

/**
 * Starts the timer that rots a corpse away. ref: src/mkobj.c start_corpse_timeout(): the
 * corpse's age counts toward ROT_AGE and the time varies by rnz(10) - 10 (rnz(25) - 25 for
 * level creation). Lizards, lichens, trolls (revive) and Riders are not handled.
 */
export function startCorpseTimeout(ctx: Ctx, id: number): void {
  const it = ctx.state.entities[String(id)]?.c.item;
  if (!it) return;
  const rotAdjust = 10;
  const age = Math.max(ctx.state.turn, 1) - (it.age ?? 0);
  let when = age > ROT_AGE ? rotAdjust : ROT_AGE - age;
  when += rnz(ctx, rotAdjust) - rotAdjust;
  ctx.schedule(Math.max(when, 1), 'nh:rot_corpse', { id });
}

/** Called when a corpse rots away completely. ref: src/dig.c rot_corpse() */
function rotCorpse(ctx: Ctx, data: Json): void {
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== 'number') return;
  const e = ctx.state.entities[String(id)];
  if (!e || e.def !== 'nh:corpse' || !e.c.item) return; // eaten, merged away or gone
  const carriedByHero = e.c.item.carriedBy === ctx.state.playerId;
  const v = hungerData(ctx).victual;
  if (carriedByHero) {
    // ref: src/dig.c rot_corpse(): "Your newt corpse rots away."
    ctx.emit({
      type: 'msg',
      key: 'corpse.rots_away',
      params: { item: xnameOf(ctx.state, ctx.defs, e) },
    });
  }
  // ref: src/eat.c food_disappears(): a meal on this corpse is over
  if (v && v.piece === id) {
    hungerData(ctx).victual = null;
    ctx.interrupt();
  }
  ctx.remove(id);
  if (carriedByHero) encumberMsg(ctx);
}

export function registerCorpses(api: ModApi): void {
  api.defineTimer({ id: 'nh:rot_corpse', fire: rotCorpse });
}
