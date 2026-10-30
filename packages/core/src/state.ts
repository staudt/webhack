import type { Pos } from './types/common';
import type { Entity } from './types/entity';
import type { Level } from './types/level';
import type { GameState } from './types/state';

export function getPlayer(state: GameState): Entity {
  const p = state.entities[String(state.playerId)];
  if (!p) throw new Error(`Player entity ${state.playerId} is missing`);
  return p;
}

export function getLevel(state: GameState, id = state.currentLevel): Level {
  const level = state.levels[id];
  if (!level) throw new Error(`Level '${id}' is missing`);
  return level;
}

/** Player position on the current level. */
export function playerPos(state: GameState): Pos {
  const pos = getPlayer(state).c.pos;
  if (!pos) throw new Error('Player has no position');
  return { x: pos.x, y: pos.y };
}

export function isVisible(state: GameState, index: number): boolean {
  const v = state.visible;
  let lo = 0;
  let hi = v.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = v[mid] as number;
    if (m === index) return true;
    if (m < index) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
