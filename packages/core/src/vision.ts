import type { Pos } from './types/common';
import type { Level } from './types/level';
import type { CellRules } from './movement';

/**
 * Cells the hero at `from` can see: in line of sight AND (adjacent OR lit), where a lit wall or
 * closed door also needs its neighbor toward the hero to be lit.
 * ref: src/vision.c vision_recalc() -- a position is IN_SIGHT if COULD_SEE and
 * (lev->lit || TEMP_LIT), or if it is next to the hero (night vision radius 1,
 * "We see this position because of night- or xray-vision").
 * Line of sight uses symmetric recursive shadowcasting (Albert Ford) rather than
 * vision.c's clear_path tables; see DEVIATIONS.md.
 */
export function computeVisible(level: Level, rules: CellRules, from: Pos): number[] {
  const { width, height, cells } = level;
  const n = width * height;
  const los = new Uint8Array(n);
  const ox = from.x;
  const oy = from.y;
  if (ox < 0 || oy < 0 || ox >= width || oy >= height) return [];
  los[oy * width + ox] = 1;

  const opaque = rules.opaque;
  // quadrant k: 0 north, 1 east, 2 south, 3 west
  const tileX = (q: number, depth: number, col: number): number =>
    q === 0 || q === 2 ? ox + col : q === 1 ? ox + depth : ox - depth;
  const tileY = (q: number, depth: number, col: number): number =>
    q === 1 || q === 3 ? oy + col : q === 0 ? oy - depth : oy + depth;

  // Slopes are exact fractions sn/sd (sd > 0).
  const scan = (
    q: number,
    depth: number,
    sn0: number,
    sd0: number,
    en0: number,
    ed0: number,
  ): void => {
    let sn = sn0;
    let sd = sd0;
    // min_col = round_ties_up(depth * start) ; max_col = round_ties_down(depth * end)
    const minCol = Math.floor((2 * depth * sn + sd) / (2 * sd));
    const maxCol = Math.ceil((2 * depth * en0 - ed0) / (2 * ed0));
    let prevWall = -1; // -1 none, 1 wall, 0 floor
    for (let col = minCol; col <= maxCol; col++) {
      const x = tileX(q, depth, col);
      const y = tileY(q, depth, col);
      const inb = x >= 0 && y >= 0 && x < width && y < height;
      const idx = y * width + x;
      const wall = !inb || opaque[cells[idx] ?? 0] === true;
      // is_symmetric: col in [depth*start, depth*end]
      const sym = col * sd >= depth * sn && col * ed0 <= depth * en0;
      if (inb && (wall || sym)) los[idx] = 1;
      if (prevWall === 1 && !wall) {
        sn = 2 * col - 1;
        sd = 2 * depth;
      }
      if (prevWall === 0 && wall) {
        scan(q, depth + 1, sn, sd, 2 * col - 1, 2 * depth);
      }
      prevWall = wall ? 1 : 0;
    }
    if (prevWall === 0) scan(q, depth + 1, sn, sd, en0, ed0);
  };
  for (let q = 0; q < 4; q++) scan(q, 1, -1, 1, 1, 1);

  const out: number[] = [];
  const lit = level.lit;
  for (let i = 0; i < n; i++) {
    if (los[i] !== 1) continue;
    const x = i % width;
    const y = (i - x) / width;
    // Night vision: the hero always sees the cells next to her.
    if (Math.abs(x - ox) <= 1 && Math.abs(y - oy) <= 1) {
      out.push(i);
      continue;
    }
    if (lit[i] !== 1) continue;
    // ref: vision_recalc() "Make sure doors, walls, boulders or mimics don't show up at the end
    // of dark hallways": a lit cell that blocks sight is seen only if the cell next to it,
    // one step toward the hero, is lit too.
    if (opaque[cells[i] ?? 0] === true) {
      const nx = x + Math.sign(ox - x);
      const ny = y + Math.sign(oy - y);
      if (lit[ny * width + nx] !== 1) continue;
    }
    out.push(i);
  }
  return out;
}

export function newMemory(level: Level): number[] {
  return new Array<number>(level.width * level.height).fill(-1);
}

/** Records currently visible terrain; returns the (sorted) indices whose remembered value changed. */
export function updateMemory(memory: number[], level: Level, visible: readonly number[]): number[] {
  const changed: number[] = [];
  for (const i of visible) {
    const v = level.cells[i] ?? 0;
    if (memory[i] !== v) {
      memory[i] = v;
      changed.push(i);
    }
  }
  return changed.sort((a, b) => a - b);
}
