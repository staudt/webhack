// Fleeing monsters. ref: src/monmove.c monflee(), distfleeck(), dochug() ("fleeing monsters might
// regain courage"), src/mon.c m_calcdistress() (the fleetim countdown)
//
// MonsterComponent is core's, so the content mod keeps `mflee` and `mfleetim` in
// `modData.nh.mflee`: an entry `{ [monsterId]: fleetim }` exists exactly while the monster flees;
// 0 means an untimed flight.
import { sortedIds, type Ctx, type EntityId, type Json, type ModApi } from '@nh/core';
import { ustuck, setUstuck } from './hackmove';
import { heroSees } from './mongear';

type Table = { [k: string]: Json };

const isObj = (v: unknown): v is Table => v !== null && typeof v === 'object' && !Array.isArray(v);

function table(ctx: Pick<Ctx, 'state'>, create: boolean): Table | null {
  const md = ctx.state.modData;
  let root = md['nh'];
  if (!isObj(root)) {
    if (!create) return null;
    root = {};
    md['nh'] = root;
  }
  let t = root['mflee'];
  if (!isObj(t)) {
    if (!create) return null;
    t = {};
    root['mflee'] = t;
  }
  return t;
}

/** `mtmp->mflee` */
export function isFleeing(ctx: Pick<Ctx, 'state'>, id: EntityId): boolean {
  const t = table(ctx, false);
  return t !== null && typeof t[String(id)] === 'number';
}

/** `mtmp->mfleetim` (0 when the flight is untimed or the monster is not fleeing) */
export function fleeTime(ctx: Pick<Ctx, 'state'>, id: EntityId): number {
  const v = table(ctx, false)?.[String(id)];
  return typeof v === 'number' ? v : 0;
}

/** `mtmp->mflee = 0` (and mfleetim = 0) */
export function stopFleeing(ctx: Pick<Ctx, 'state'>, id: EntityId): void {
  const t = table(ctx, false);
  if (t) delete t[String(id)];
}

/** ref: src/monmove.c mon_track_clear(): "ignore recently-stepped spaces when made to flee" */
function monTrackClear(ctx: Pick<Ctx, 'state'>, id: EntityId): void {
  const nh = ctx.state.modData['nh'];
  const all = isObj(nh) ? nh['mtrack'] : undefined;
  if (isObj(all)) delete all[String(id)];
}

/**
 * Makes the monster flee for `fleetime` turns (0 = until it recovers on its own).
 * ref: src/monmove.c monflee(). `first` leaves an existing flight alone; `fleemsg` announces it
 * ("The jackal turns to flee.") when the hero sees the monster. Not ported: immobile monsters
 * ("seems to flinch"), flees_light() ("flees from the painful light"), the vrock's gas cloud.
 */
export function monflee(
  ctx: Ctx,
  id: EntityId,
  fleetime: number,
  first: boolean,
  fleemsg: boolean,
): void {
  const mon = ctx.state.entities[String(id)];
  if (!mon?.c.monster) return;
  if (ustuck(ctx) === id) setUstuck(ctx, null); // release_hero()
  const t = table(ctx, true);
  if (!t) return;
  const key = String(id);
  const flee = typeof t[key] === 'number';
  if (!first || !flee) {
    let tim = typeof t[key] === 'number' ? (t[key] as number) : 0;
    if (!fleetime) {
      tim = 0; // don't lose untimed scare
    } else if (!flee || tim) {
      fleetime += tim;
      // ensure monster flees long enough to visibly stop fighting
      if (fleetime === 1) fleetime++;
      tim = Math.min(fleetime, 127);
    }
    if (!flee && fleemsg && mon.c.pos && heroSees(ctx, mon.c.pos)) {
      ctx.emit({ type: 'msg', key: 'mon.turns_to_flee', params: { mon: `@${mon.def}` } });
    }
    t[key] = tim; // mflee = 1
  }
  monTrackClear(ctx, id);
}

/**
 * A fleeing monster may regain courage: untimed flight, full hit points, 1 in 25.
 * ref: src/monmove.c dochug() "fleeing monsters might regain courage"
 */
export function regainCourage(ctx: Ctx, id: EntityId): void {
  const mon = ctx.state.entities[String(id)];
  const hp = mon?.c.hp;
  if (isFleeing(ctx, id) && fleeTime(ctx, id) === 0 && hp && hp.cur === hp.max) {
    if (ctx.rng.rn2(25) === 0) stopFleeing(ctx, id);
  }
}

/**
 * The flight timers count down once a turn; at 0 the monster stops fleeing. Entries of monsters
 * that no longer exist are dropped.
 * ref: src/mon.c m_calcdistress(): `if (mtmp->mfleetim && !--mtmp->mfleetim) mtmp->mflee = 0;`
 */
export function registerMonflee(api: ModApi): void {
  api.on('endOfTurn', (ctx) => {
    const t = table(ctx, false);
    if (!t) return;
    for (const id of sortedIds(ctx.state)) {
      const v = t[String(id)];
      if (typeof v !== 'number' || v === 0) continue;
      if (v - 1 === 0) delete t[String(id)];
      else t[String(id)] = v - 1;
    }
    // forget the dead
    for (const key of Object.keys(t).sort()) {
      if (!ctx.state.entities[key]?.c.monster) delete t[key];
    }
  });
}
