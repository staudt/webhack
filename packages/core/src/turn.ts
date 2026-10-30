import { getPlayer } from './state';
import { NORMAL_SPEED } from './types/entity';
import type { Ctx } from './types/mod';
import type { EntityId } from './types/common';
import { sortedIds } from './util';

/** Ids of non-hero actors on the current level that have a brain, in sorted order. */
function monsterIds(ctx: Ctx): EntityId[] {
  const { state, defs } = ctx;
  return sortedIds(state).filter((id) => {
    const e = state.entities[String(id)];
    return (
      e !== undefined &&
      id !== state.playerId &&
      e.c.actor !== undefined &&
      e.c.pos?.level === state.currentLevel &&
      defs.isMonster(e.def)
    );
  });
}

const stopped = (ctx: Ctx): boolean =>
  ctx.state.gameOver !== null || ctx.state.pendingPrompt !== null;

/**
 * Each monster with enough movement acts once. Returns whether any can act again this turn.
 * ref: src/mon.c movemon()
 */
function movemon(ctx: Ctx): boolean {
  let somebodyCanMove = false;
  for (const id of monsterIds(ctx)) {
    const e = ctx.state.entities[String(id)];
    const actor = e?.c.actor;
    // Entities removed or moved off the level earlier in this pass are skipped.
    if (!e || !actor || e.c.pos?.level !== ctx.state.currentLevel) continue;
    if (actor.energy < NORMAL_SPEED) continue;
    actor.energy -= NORMAL_SPEED;
    if (actor.energy >= NORMAL_SPEED) somebodyCanMove = true;
    ctx.defs.brain(ctx.defs.monster(e.def).brain).act(ctx, id);
    if (stopped(ctx)) return false;
  }
  return somebodyCanMove;
}

/**
 * Runs monsters and ends turns until the hero can act again (or the game stops).
 * ref: src/allmain.c moveloop_core() -- "actual time passed" block
 */
export function advanceTime(ctx: Ctx): void {
  const { state } = ctx;
  const actor = getPlayer(state).c.actor;
  if (!actor) throw new Error('Player has no actor component');
  if (actor.speed <= 0) throw new Error('Player speed must be positive');
  while (actor.energy < NORMAL_SPEED && !stopped(ctx)) {
    const monscanmove = movemon(ctx);
    if (stopped(ctx) || actor.energy >= NORMAL_SPEED) break;
    if (!monscanmove) endTurn(ctx);
  }
}

function endTurn(ctx: Ctx): void {
  const { state, defs } = ctx;
  // ref: src/allmain.c moveloop_core() mtmp->movement += mcalcmove(mtmp, TRUE)
  for (const id of monsterIds(ctx)) {
    const e = state.entities[String(id)];
    const a = e?.c.actor;
    if (!e || !a) continue;
    const brain = defs.brain(defs.monster(e.def).brain);
    a.energy += brain.movement ? brain.movement(ctx, id) : a.speed;
  }
  // ref: src/allmain.c moveloop_core() u.umovement += moveamt
  const hero = getPlayer(state).c.actor;
  if (hero) hero.energy += hero.speed;
  state.turn += 1;
  // Due timers fire in (at, seq) order; timers they schedule run on later turns.
  while (state.timers.length > 0 && (state.timers[0]?.at ?? Infinity) <= state.turn) {
    const t = state.timers.shift();
    if (t) defs.timer(t.kind).fire(ctx, t.data);
  }
  for (const h of defs.hooks('endOfTurn')) h.fn(ctx);
  ctx.emit({ type: 'turnEnded', turn: state.turn });
}
