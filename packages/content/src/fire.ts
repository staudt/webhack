// Firing ammunition from a wielded launcher (the #fire command).
// ref: src/dothrow.c dofire(), throw_obj() with ammo_and_launcher(), throwit()
import {
  DIR_LIST,
  inventoryOf,
  type ActionDef,
  type Ctx,
  type DefId,
  type Json,
  type Offer,
} from '@nh/core';
import { DIRECTION_OPTIONS, heroItem, itemArg, throwObj } from './dothrow';
import { checkCapacity } from './magic';
import { ammoAndLauncher, isMissile } from './mthrowu';

export const FIRE_ID: DefId = 'nh:fire';

/** Whether the item is something `f` fires: ammo with its launcher wielded, or a missile. */
function firable(ctx: Ctx, defId: DefId): boolean {
  const def = ctx.defs.object(defId);
  if (isMissile(def)) return true;
  const uwep = inventoryOf(ctx.state, ctx.state.playerId).find(
    (o) => o.c.item?.equipped === 'weapon',
  );
  return uwep !== undefined && ammoAndLauncher(def, ctx.defs.object(uwep.def));
}

/**
 * `nh:fire`: shoot an item in a direction. It is offered on ammo when the matching launcher is
 * wielded (and on darts, which need none) and reuses the throw flight (multishot, range, to-hit
 * and damage all consult the wielded launcher). There is no quiver (see DEVIATIONS.md): the
 * player picks the ammo each time, which the app does with an item picker bound to `f`.
 * ref: src/dothrow.c dofire()
 */
const fireAction: ActionDef = {
  id: FIRE_ID,
  labelKey: 'action.nh:fire',
  handles: 'mod',
  offer(ctx, target): Offer[] {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    if (!e?.c.item || e.c.item.equipped !== null || !firable(ctx, e.def)) return [];
    return [
      {
        action: { type: 'mod', action: FIRE_ID, args: { item: e.id } },
        labelKey: 'action.nh:fire',
      },
    ];
  },
  // ref: dofire(): ok_to_throw(), then throw_obj() asks "In what direction?"
  perform(ctx, action) {
    const e = heroItem(ctx, itemArg(action));
    if (!e || !firable(ctx, e.def)) return 0;
    if (checkCapacity(ctx)) return 0;
    ctx.ask(
      {
        id: 'fire-direction',
        kind: 'direction',
        key: 'throw.direction',
        options: DIRECTION_OPTIONS,
      },
      FIRE_ID,
      { item: e.id },
    );
    return 0;
  },
  answer(ctx, value: Json, raw: Json) {
    const e = heroItem(ctx, (raw as { item?: unknown } | null)?.item);
    const dir = DIR_LIST.find((d) => d === value);
    if (!e || !dir) return 0; // cancelled
    return throwObj(ctx, e, dir);
  },
};

export const FIRE_ACTIONS: readonly ActionDef[] = [fireAction];
