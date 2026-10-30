// Multi-turn helplessness. ref: src/hack.c nomul() with a negative count, unmul(), nomovemsg
import { NORMAL_SPEED, getPlayer, type Ctx, type ModApi, type Msg } from '@nh/core';
import { nhData } from './items';

/**
 * Makes the hero helpless for `turns` more moves after the current action, and returns the
 * extra energy the caller must add to the action's cost (`turns * 12`), so monsters get their
 * turns while she is occupied. `reasonKey` says why (ref: multi_reason); `finish` is shown when
 * it ends (ref: nomovemsg). The helpless component is cleared at the end of the last turn.
 * Example: `return NORMAL_SPEED + nomul(ctx, delay, 'helpless.dressing', finishMsg)`.
 */
export function nomul(
  ctx: Ctx,
  turns: number,
  reasonKey: string,
  finish: Msg | null = null,
): number {
  if (turns <= 0) return 0;
  const hero = getPlayer(ctx.state);
  hero.c.helpless = { until: ctx.state.turn + 1 + turns, reasonKey };
  nhData(ctx).nomovemsg = finish;
  return turns * NORMAL_SPEED;
}

/** Ends helplessness when its time is up, with the finishing message. ref: src/hack.c unmul() */
export function registerNomul(api: ModApi): void {
  api.on('endOfTurn', (ctx) => {
    const hero = getPlayer(ctx.state);
    const h = hero.c.helpless;
    if (!h || ctx.state.turn < h.until) return;
    delete hero.c.helpless;
    const data = nhData(ctx);
    const msg = data.nomovemsg;
    data.nomovemsg = null;
    if (msg) ctx.emit({ type: 'msg', key: msg.key, ...(msg.params ? { params: msg.params } : {}) });
  });
}
