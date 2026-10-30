import type { CellRules } from '../../src/movement';
import type { Level } from '../../src/types/level';
import type { DefId } from '../../src/types/common';

/** Palette indices, fixed so tests can refer to them. */
export const PAL = {
  stone: 0,
  wall: 1,
  floor: 2,
  corridor: 3,
  closed: 4,
  open: 5,
  doorway: 6,
  up: 7,
  down: 8,
} as const;
const CHARS: Record<string, number> = {
  ' ': PAL.stone,
  '|': PAL.wall,
  '-': PAL.wall,
  '.': PAL.floor,
  '#': PAL.corridor,
  '+': PAL.closed,
  o: PAL.open,
  d: PAL.doorway,
  '<': PAL.up,
  '>': PAL.down,
};
const palette: DefId[] = [
  'nh:stone',
  'nh:wall',
  'nh:floor',
  'nh:corridor',
  'nh:door_closed',
  'nh:door_open',
  'nh:doorway',
  'nh:stairs_up',
  'nh:stairs_down',
];
const flags = (f: (i: number) => boolean): boolean[] => palette.map((_, i) => f(i));
export const RULES: CellRules = {
  passable: flags((i) => i !== PAL.stone && i !== PAL.wall && i !== PAL.closed),
  opaque: flags((i) => i === PAL.stone || i === PAL.wall || i === PAL.closed),
  closedDoor: flags((i) => i === PAL.closed),
  intactDoor: flags((i) => i === PAL.closed || i === PAL.open),
};

/** Builds a Level from ASCII rows. `lit` rows use 'L' for lit; default all dark. Rows are padded with stone. */
export function asciiLevel(rows: readonly string[], lit?: readonly string[]): Level {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells: number[] = [];
  const litArr: (0 | 1)[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(CHARS[rows[y]?.[x] ?? ' '] ?? PAL.stone);
      litArr.push(lit?.[y]?.[x] === 'L' ? 1 : 0);
    }
  }
  return {
    id: 'test',
    depth: 1,
    width,
    height,
    palette: [...palette],
    cells,
    lit: litArr,
    rooms: [],
    up: null,
    down: null,
  };
}

export function litAll(level: Level): Level {
  level.lit = level.lit.map(() => 1);
  return level;
}

export const idx = (l: Level, x: number, y: number): number => y * l.width + x;
