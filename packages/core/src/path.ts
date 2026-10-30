import type { Pos } from './types/common';
import type { Level } from './types/level';
import type { CellRules } from './movement';
import { DIR_LIST, DIRS, cellIndex, inBounds } from './util';

/**
 * A* over remembered cells. Closed doors are traversable (moving in auto-opens),
 * diagonal moves into/out of intact doors are forbidden (ref: src/hack.c test_move()).
 * Returns path excluding `from`, including `to`; [] if equal; null if unreachable.
 */
export function findPath(
  level: Level,
  rules: CellRules,
  memory: readonly number[],
  from: Pos,
  to: Pos,
): Pos[] | null {
  const { width, height } = level;
  if (!inBounds(level, from.x, from.y) || !inBounds(level, to.x, to.y)) return null;
  const start = cellIndex(level, from.x, from.y);
  const goal = cellIndex(level, to.x, to.y);
  if (start === goal) return [];

  const walkable = (i: number): boolean => {
    const m = memory[i] ?? -1;
    if (m < 0) return false;
    return rules.passable[m] === true || rules.closedDoor[m] === true;
  };
  if (!walkable(goal)) return null;

  const n = width * height;
  const g = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const h = (x: number, y: number): number => Math.max(Math.abs(x - to.x), Math.abs(y - to.y));
  // heap of packed keys: ((f * 4096) + h) * 2^24 + idx -> orders by f, then h, then index
  const heap: number[] = [];
  const IDX = 16777216;
  const push = (key: number): void => {
    let i = heap.length;
    heap.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as number) <= key) break;
      heap[i] = heap[p] as number;
      i = p;
    }
    heap[i] = key;
  };
  const pop = (): number => {
    const top = heap[0] as number;
    const last = heap.pop() as number;
    const len = heap.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && (heap[c + 1] as number) < (heap[c] as number)) c++;
        if ((heap[c] as number) >= last) break;
        heap[i] = heap[c] as number;
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  const keyOf = (gv: number, hv: number, idx: number): number =>
    ((gv + hv) * 4096 + Math.min(hv, 4095)) * IDX + idx;

  g[start] = 0;
  push(keyOf(0, h(from.x, from.y), start));
  while (heap.length > 0) {
    const key = pop();
    const cur = key % IDX;
    const cg = g[cur] as number;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    const ch = h(cx, cy);
    if (Math.floor(key / IDX / 4096) !== cg + ch) continue; // stale entry
    if (cur === goal) break;
    const curDoor = rules.intactDoor[memory[cur] as number] === true;
    for (const dir of DIR_LIST) {
      const d = DIRS[dir];
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!walkable(ni)) continue;
      if (d.x !== 0 && d.y !== 0 && (curDoor || rules.intactDoor[memory[ni] as number] === true))
        continue;
      const ng = cg + 1;
      const old = g[ni] as number;
      if (old !== -1 && old <= ng) continue;
      g[ni] = ng;
      parent[ni] = cur;
      push(keyOf(ng, h(nx, ny), ni));
    }
  }
  if (g[goal] === -1) return null;
  const path: Pos[] = [];
  for (let i = goal; i !== start; i = parent[i] as number) {
    const x = i % width;
    path.push({ x, y: (i - x) / width });
  }
  return path.reverse();
}
