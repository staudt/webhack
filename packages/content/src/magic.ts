// Shared helpers for quaffing, reading and throwing: using up objects and the "strange feeling" fallback.
// ref: src/invent.c useup(), src/potion.c strange_feeling(), src/hack.c check_capacity()
import type { Ctx, Entity, EntityId, Msg, Params } from '@nh/core';
import { getPlayer } from '@nh/core';
import { encumberMsg } from './itemactions';
import { nhData, removeFromInventory } from './items';
import { nearCapacity } from './stats';

export const heroEntity = (ctx: Pick<Ctx, 'state'>): Entity => getPlayer(ctx.state);

/** ref: include/hack.h EXT_ENCUMBER (Overtaxed) in near_capacity() terms */
const EXT_ENCUMBER = 4;

/** ref: src/hack.c check_capacity(): "You can't do that while carrying so much stuff." */
export function checkCapacity(ctx: Ctx): boolean {
  if (nearCapacity(ctx.state, ctx.defs, ctx.state.playerId) >= EXT_ENCUMBER) {
    ctx.emit({ type: 'msg', key: 'magic.cant_do_that' });
    return true;
  }
  return false;
}

/**
 * Uses up one object of the stack, or the whole item when it is the last. ref: src/invent.c
 * useup(), useupall(). The item must be in the hero's inventory.
 */
export function useup(ctx: Ctx, id: EntityId): void {
  const e = ctx.state.entities[String(id)];
  const it = e?.c.item;
  if (!e || !it) return;
  if (it.quantity > 1) {
    it.quantity--;
  } else {
    removeFromInventory(ctx, id);
    ctx.remove(id);
  }
  encumberMsg(ctx);
}

/** Uses up the whole stack. ref: src/invent.c useupall() */
export function useupall(ctx: Ctx, id: EntityId): void {
  removeFromInventory(ctx, id);
  ctx.remove(id);
  encumberMsg(ctx);
}

/**
 * ref: include/flag.h flags.beginner: true until the score `u.urexp` reaches 2000 (src/exper.c
 * more_experienced()). The score is not tracked here, so `modData.nh.urexp` stands in for it
 * (absent = 0, a beginner).
 */
export function isBeginner(ctx: Pick<Ctx, 'state'>): boolean {
  const urexp = (nhData(ctx) as unknown as { urexp?: number }).urexp ?? 0;
  return urexp < 2000;
}

/**
 * "You have a strange feeling for a moment, then it passes." for beginners, else the specific
 * message; then the object is used up. ref: src/potion.c strange_feeling() (without the
 * trycall: naming unknown types is not implemented).
 */
export function strangeFeeling(
  ctx: Ctx,
  item: EntityId | null,
  key: string | null,
  params?: Params,
): void {
  if (isBeginner(ctx) || key === null) ctx.emit({ type: 'msg', key: 'magic.strange_feeling' });
  else ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });
  if (item !== null) useup(ctx, item);
}

/** A color name message. ref: src/hack.c hcolor() (never hallucinating) */
export const color = (name: 'blue' | 'black' | 'silver' | 'amber'): Msg => ({
  key: `color.${name}`,
});
