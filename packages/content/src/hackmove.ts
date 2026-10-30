// The hero's impaired movement: stun and being stuck to a monster.
// ref: src/hack.c u_maybe_impaired(), impaired_movement(), escape_from_sticky_mon();
// src/cmd.c confdir(); src/mon.c set_ustuck(), unstuck()
import {
  DIRS,
  cellIndex,
  cellRules,
  getLevel,
  getPlayer,
  inBounds,
  type Ctx,
  type Dir,
  type EntityId,
} from '@nh/core';
import { nhData } from './items';
import { P, hasProp } from './props';

/** ref: src/decl.c dirs_ord[]: the order in which confdir() picks a random direction. */
const DIRS_ORD: readonly Dir[] = ['w', 'n', 'e', 's', 'nw', 'ne', 'se', 'sw'];

/** ref: src/hack.c u_maybe_impaired(): stunned (confusion does not exist yet) */
export function uMaybeImpaired(ctx: Ctx): boolean {
  return hasProp(getPlayer(ctx.state), P.STUNNED);
}

/**
 * The monster the hero is stuck to (u.ustuck), or null. A sticker that is gone, on another level
 * or no longer next to the hero lets go (the checks of escape_from_sticky_mon() and m_move()).
 * The id is kept in the content mod's data.
 */
export function ustuck(ctx: Pick<Ctx, 'state'>): EntityId | null {
  const d = nhData(ctx) as unknown as { ustuck?: EntityId | null };
  const id = d.ustuck ?? null;
  if (id === null) return null;
  const m = ctx.state.entities[String(id)];
  const hp = getPlayer(ctx.state).c.pos;
  const mp = m?.c.pos;
  if (
    !m?.c.monster ||
    !mp ||
    !hp ||
    mp.level !== hp.level ||
    Math.max(Math.abs(mp.x - hp.x), Math.abs(mp.y - hp.y)) > 1
  ) {
    d.ustuck = null;
    return null;
  }
  return id;
}

/** ref: src/mon.c set_ustuck() */
export function setUstuck(ctx: Pick<Ctx, 'state'>, id: EntityId | null): void {
  (nhData(ctx) as unknown as { ustuck?: EntityId | null }).ustuck = id;
}

/**
 * A stunned hero moves in a random direction that is not solid rock. Returns the direction to
 * use, or null when 50 tries found none ("can't move"; the move is still spent).
 * ref: src/hack.c impaired_movement() with src/cmd.c confdir(TRUE): `dirs_ord[rn2(8)]`, retried
 * while the square is out of the map or `bad_rock()`.
 */
export function impairedDir(ctx: Ctx, dir: Dir): Dir | null {
  if (!uMaybeImpaired(ctx)) return dir;
  const hero = getPlayer(ctx.state);
  const pos = hero.c.pos;
  if (!pos) return dir;
  const level = getLevel(ctx.state, pos.level);
  const rules = cellRules(level, ctx.defs);
  let tries = 0;
  for (;;) {
    if (tries++ > 50) return null;
    const k = DIRS_ORD[ctx.rng.rn2(DIRS_ORD.length)] ?? dir;
    const d = DIRS[k];
    const x = pos.x + d.x;
    const y = pos.y + d.y;
    if (!inBounds(level, x, y)) continue;
    // bad_rock(): solid rock and walls, but not closed doors
    const i = level.cells[cellIndex(level, x, y)] ?? 0;
    if (!rules.passable[i] && !rules.closedDoor[i]) continue;
    return k;
  }
}

/**
 * Tries to pull free of the monster the hero is stuck to when moving to `to`. Returns true when
 * the hero loses the move. ref: src/hack.c escape_from_sticky_mon(): a sticker that is not
 * next to the hero is forgotten; otherwise 3 in 40 pull free ("holder asleep or paralyzed" and
 * tame cases do not apply: no monster here is frozen or tame).
 */
export function escapeFromStickyMon(ctx: Ctx, to: { x: number; y: number }): boolean {
  const id = ustuck(ctx);
  if (id === null) return false;
  const m = ctx.state.entities[String(id)];
  const mp = m?.c.pos;
  if (!m || !mp || (to.x === mp.x && to.y === mp.y)) return false; // moving onto it is an attack
  if (ctx.rng.rn2(40) < 3) {
    setUstuck(ctx, null);
    ctx.emit({ type: 'msg', key: 'stuck.pull_free', params: { mon: `@${m.def}` } });
    return false;
  }
  ctx.emit({ type: 'msg', key: 'stuck.cannot_escape', params: { mon: `@${m.def}` } });
  ctx.interrupt(); // nomul(0)
  return true;
}
