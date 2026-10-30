import type { DefId, LevelId, Pos } from './common';

/** Room interior bounds, inclusive. ref: include/mkroom.h struct mkroom */
export interface Room {
  lx: number;
  ly: number;
  hx: number;
  hy: number;
  lit: boolean;
}

export interface Level {
  id: LevelId;
  depth: number;
  width: number;
  height: number;
  /** Terrain defs used on this level; `cells` index into it. */
  palette: DefId[];
  /** Row-major, `i = y * width + x`. */
  cells: number[];
  lit: (0 | 1)[];
  rooms: Room[];
  up: Pos | null;
  down: Pos | null;
}
