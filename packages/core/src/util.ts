import type { Dir } from './types/action';
import type { EntityId, Pos } from './types/common';
import type { GameState } from './types/state';

export function sortedIds(state: GameState): EntityId[] {
  return Object.keys(state.entities)
    .map(Number)
    .sort((a, b) => a - b);
}

export function cellIndex(level: { width: number }, x: number, y: number): number {
  return y * level.width + x;
}

export function inBounds(level: { width: number; height: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.width && y < level.height;
}

export const DIRS: Record<Dir, Pos> = {
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  nw: { x: -1, y: -1 },
};

export const DIR_LIST: readonly Dir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
