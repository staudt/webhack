import type { Dir } from './types/action';
import type { Pos } from './types/common';
import type { Level } from './types/level';
import type { Registry } from './types/mod';
import { DIRS, cellIndex, inBounds } from './util';

/** Per-palette-index terrain rules, so movement/vision/path need no registry at runtime. */
export interface CellRules {
  passable: readonly boolean[];
  opaque: readonly boolean[];
  closedDoor: readonly boolean[];
  /** Door that blocks diagonal moves: an 'open' or 'closed' door (not a doorway/broken door). */
  intactDoor: readonly boolean[];
}

export function cellRules(level: Level, registry: Registry): CellRules {
  const passable: boolean[] = [];
  const opaque: boolean[] = [];
  const closedDoor: boolean[] = [];
  const intactDoor: boolean[] = [];
  for (const id of level.palette) {
    const t = registry.terrain(id);
    passable.push(t.passable);
    opaque.push(t.opaque);
    closedDoor.push(t.door === 'closed');
    // ref: src/hack.c test_move() -- doorless_door(): D_NODOOR/D_BROKEN doorways don't block diagonals
    intactDoor.push(t.door === 'closed' || t.door === 'open');
  }
  return { passable, opaque, closedDoor, intactDoor };
}

export type StepCheck =
  { ok: true } | { ok: false; reason: 'bounds' | 'blocked' | 'closedDoor' | 'diagonalDoor' };

/**
 * Terrain part of the hero's move test.
 * Note: squeezing diagonally between two rock/wall cells is allowed for the player;
 * cant_squeeze_thru() returns 0 for a normal hero with light inventory.
 * ref: src/hack.c test_move()
 */
export function checkStep(level: Level, rules: CellRules, from: Pos, dir: Dir): StepCheck {
  const d = DIRS[dir];
  const tx = from.x + d.x;
  const ty = from.y + d.y;
  if (!inBounds(level, tx, ty)) return { ok: false, reason: 'bounds' };
  const diagonal = d.x !== 0 && d.y !== 0;
  const to = level.cells[cellIndex(level, tx, ty)] ?? 0;
  if (diagonal) {
    // ref: src/hack.c test_move() "Diagonal moves into a door are not allowed."
    if (rules.intactDoor[to]) return { ok: false, reason: 'diagonalDoor' };
    // ref: src/hack.c test_move() "Can't move at a diagonal out of a doorway with door."
    if (inBounds(level, from.x, from.y)) {
      const here = level.cells[cellIndex(level, from.x, from.y)] ?? 0;
      if (rules.intactDoor[here]) return { ok: false, reason: 'diagonalDoor' };
    }
  }
  if (rules.closedDoor[to]) return { ok: false, reason: 'closedDoor' };
  if (!rules.passable[to]) return { ok: false, reason: 'blocked' };
  return { ok: true };
}
