import { getPlayer } from './state';
import { NORMAL_SPEED } from './types/entity';
import type { Ctx } from './types/mod';
import { sortedIds } from './util';

/**
 * Ends turns until the player has enough movement to act again.
 * ref: src/allmain.c moveloop_core() -- "actual time passed" block
 */
export function advanceTime(ctx: Ctx): void {
  const { state } = ctx;
  const actor = getPlayer(state).c.actor;
  if (!actor) throw new Error('Player has no actor component');
  if (actor.speed <= 0) throw new Error('Player speed must be positive');
  while (actor.energy < NORMAL_SPEED) endTurn(ctx);
}

function endTurn(ctx: Ctx): void {
  const { state, defs } = ctx;
  state.turn += 1;
  // Due timers fire in (at, seq) order; timers they schedule run on later turns.
  while (state.timers.length > 0 && (state.timers[0]?.at ?? Infinity) <= state.turn) {
    const t = state.timers.shift();
    if (t) defs.timer(t.kind).fire(ctx, t.data);
  }
  for (const h of defs.hooks('endOfTurn')) h.fn(ctx);
  // ref: src/allmain.c moveloop_core() u.umovement += moveamt; mcalcmove() for monsters
  for (const id of sortedIds(state)) {
    const a = state.entities[String(id)]?.c.actor;
    if (a) a.energy += a.speed;
  }
  ctx.emit({ type: 'turnEnded', turn: state.turn });
}
