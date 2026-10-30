// Filling the rooms of a new level with a monster, gold and objects.
// ref: src/mklev.c fill_ordinary_room(), makelevel()
import type { Ctx, Level, ModApi, Pos, Room } from '@nh/core';
import { cellIndex } from '@nh/core';
import { makemon } from './generation';
import { mkgold } from './items';
import { mkobjAt } from './mkobj';

/**
 * A random free floor square in the room, or null after 100 failed tries (101 attempts).
 * ref: src/mkroom.c somexyspace(): somexy() = rn1(hx - lx + 1, lx), rn1(hy - ly + 1, ly), which
 * must be plain ROOM floor (not stairs, a door or other furniture); `occupied()` ignores
 * monsters. Stairs stand in for all furniture, as no other exists.
 */
export function somexyspace(ctx: Pick<Ctx, 'rng'>, level: Level, room: Room): Pos | null {
  for (let trycnt = 0; trycnt <= 100; trycnt++) {
    const x = room.lx + ctx.rng.rn2(room.hx - room.lx + 1);
    const y = room.ly + ctx.rng.rn2(room.hy - room.ly + 1);
    const t = level.palette[level.cells[cellIndex(level, x, y)] ?? 0];
    if (t === 'nh:floor') return { x, y };
  }
  return null;
}

/**
 * One ordinary room's contents, in mklev's order: a monster (1 in 3), gold (1 in 3), then random
 * objects (1 in 3 for the first, then 1 in 5 for each further one).
 * ref: src/mklev.c fill_ordinary_room(). Traps, mimics, fountains, sinks, altars, graves,
 * statues, boxes, engravings and the bonus items are not made, and so do not roll.
 */
export function fillOrdinaryRoom(ctx: Ctx, level: Level, room: Room): void {
  let pos: Pos | null;
  // put a sleeping monster inside
  if (ctx.rng.rn2(3) === 0 && (pos = somexyspace(ctx, level, room)))
    makemon(ctx, null, pos, { level: level.id, nogroup: true });
  if (ctx.rng.rn2(3) === 0 && (pos = somexyspace(ctx, level, room)))
    mkgold(ctx, 0, { level: level.id, x: pos.x, y: pos.y });
  if (ctx.rng.rn2(3) === 0 && (pos = somexyspace(ctx, level, room))) {
    mkobjAt(ctx, 'random', { level: level.id, x: pos.x, y: pos.y }, true);
    for (let trycnt = 0; ctx.rng.rn2(5) === 0;) {
      if (++trycnt > 100) break; // impossible("trycnt overflow4")
      if ((pos = somexyspace(ctx, level, room)))
        mkobjAt(ctx, 'random', { level: level.id, x: pos.x, y: pos.y }, true);
    }
  }
}

/** Registers level population. */
export function registerMklev(api: ModApi): void {
  api.on('newLevel', (ctx, level) => {
    for (const room of level.rooms) fillOrdinaryRoom(ctx, level, room);
  });
}
