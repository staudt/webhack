import type { Level, Room } from '../types/level';
import type { Pos } from '../types/common';
import type { Rng } from '../types/rng';
import { ensureConnected, makeCorridors } from './corridors';
import { D_CLOSED, D_HORIZ, D_ISOPEN, Grid, T, type IRoom } from './grid';
import { maxRooms, makeRooms, sortRooms } from './rooms';
import { PAL, PALETTE_KEYS, type LevelTerrain } from './terrain';
import type { LevelId } from '../types/common';

/**
 * Smallest supported map. NetHack's room placement (rect.c / create_room) needs a free rectangle
 * at least 9 rows and 10 columns across; below that no room can ever be placed.
 */
export const MIN_LEVEL_WIDTH = 10;
export const MIN_LEVEL_HEIGHT = 10;

/** How often an empty result (no rooms placed) is retried with the continuing RNG stream. */
const MAX_ATTEMPTS = 20;

export interface GenOptions {
  id: LevelId;
  depth: number;
  width: number;
  height: number;
  terrain: LevelTerrain;
}

/** ref: src/mklev.c somexy() for plain (non-irregular, subroom-free) rooms */
function somexy(rng: Rng, r: IRoom): Pos {
  return { x: rng.rn2(r.hx - r.lx + 1) + r.lx, y: rng.rn2(r.hy - r.ly + 1) + r.ly };
}

/**
 * Choose rooms and cells for down and up stairs.
 * ref: src/mklev.c generate_stairs() / generate_stairs_find_room(): down stairs in any room, up stairs
 * in a different room when one exists, else the same room (on a different cell).
 */
function placeStairs(g: Grid, rng: Rng): { down: Pos; up: Pos } {
  const n = g.rooms.length;
  const downIdx = rng.rn2(n); // phase 2: every room is eligible
  const downRoom = g.rooms[downIdx] as IRoom;
  const down = somexy(rng, downRoom);

  const others: number[] = [];
  for (let i = 0; i < n; i++) if (i !== downIdx) others.push(i);
  const upRoom = g.rooms[
    others.length ? (others[rng.rn2(others.length)] as number) : downIdx
  ] as IRoom;
  let up = somexy(rng, upRoom);
  // Same-room case: avoid stacking both stairs on one cell (C would hit an impossible() here).
  for (let tries = 0; upRoom === downRoom && up.x === down.x && up.y === down.y; tries++) {
    if (tries < 100) {
      up = somexy(rng, upRoom);
    } else {
      up = { x: up.x === upRoom.hx ? upRoom.lx : up.x + 1, y: up.y };
    }
  }
  return { down, up };
}

/** Palette index for an internal cell. */
function paletteIndex(typ: number, mask: number): number {
  switch (typ) {
    case T.DOOR:
      if (mask & D_CLOSED) return PAL.door_closed;
      if (mask & D_ISOPEN) return mask & D_HORIZ ? PAL.door_open_h : PAL.door_open_v;
      return PAL.doorway;
    case T.ROOM:
      return PAL.floor;
    case T.CORR:
      return PAL.corr;
    default:
      return typ; // T.STONE..T.BRCORNER share the palette order stone,vwall,hwall,corners
  }
}

/**
 * Generate a rooms-and-corridors level.
 * ref: src/mklev.c makelevel() (ordinary level branch)
 * @throws RangeError when the size is below MIN_LEVEL_WIDTH x MIN_LEVEL_HEIGHT
 */
export function generateLevel(rng: Rng, opts: GenOptions): Level {
  const { width, height, depth } = opts;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_LEVEL_WIDTH ||
    height < MIN_LEVEL_HEIGHT
  ) {
    throw new RangeError(
      `generateLevel: size ${String(width)}x${String(height)} is below the minimum ` +
        `${String(MIN_LEVEL_WIDTH)}x${String(MIN_LEVEL_HEIGHT)}`,
    );
  }

  let g = new Grid(width, height);
  for (let attempt = 0; ; attempt++) {
    makeRooms(g, rng, depth, maxRooms(width, height));
    if (g.rooms.length > 0) break;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      throw new Error(
        `generateLevel: no rooms could be placed on a ${String(width)}x${String(height)} map`,
      );
    }
    g = new Grid(width, height);
  }
  sortRooms(g);
  makeCorridors(g, rng, depth);
  ensureConnected(g);
  const { up, down } = placeStairs(g, rng);

  const cells: number[] = new Array<number>(width * height);
  const lit: (0 | 1)[] = new Array<0 | 1>(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = g.idx(x + 1, y);
      cells[y * width + x] = paletteIndex(g.typ[i] as number, g.dmask[i] as number);
      lit[y * width + x] = g.lit[i] ? 1 : 0;
    }
  }
  cells[down.y * width + down.x - 1] = PAL.stairs_down;
  cells[up.y * width + up.x - 1] = PAL.stairs_up;

  const rooms: Room[] = g.rooms.map((r) => ({
    lx: r.lx - 1,
    ly: r.ly,
    hx: r.hx - 1,
    hy: r.hy,
    lit: r.lit,
  }));

  return {
    id: opts.id,
    depth,
    width,
    height,
    palette: PALETTE_KEYS.map((k) => opts.terrain[k]),
    cells,
    lit,
    rooms,
    up: { x: up.x - 1, y: up.y },
    down: { x: down.x - 1, y: down.y },
  };
}
