import type { Rng } from '../types/rng';
import { D_CLOSED, D_HORIZ, D_ISOPEN, Grid, T, isObstructed, isWall, type IRoom } from './grid';

type Dir = 'N' | 'S' | 'E' | 'W';
interface Pt {
  x: number;
  y: number;
}

/** Unit step from a wall door cell into its room (the DIR_180 of the preferred edge). */
const INWARD: Record<Dir, Pt> = {
  N: { x: 0, y: 1 },
  S: { x: 0, y: -1 },
  W: { x: 1, y: 0 },
  E: { x: -1, y: 0 },
};

/** ref: src/mklev.c bydoor() */
function bydoor(g: Grid, x: number, y: number): boolean {
  const isDoor = (px: number, py: number): boolean =>
    g.isok(px, py) && (g.get(px, py) === T.DOOR || g.get(px, py) === T.SDOOR);
  return isDoor(x + 1, y) || isDoor(x - 1, y) || isDoor(x, y + 1) || isDoor(x, y - 1);
}

/** ref: src/mklev.c okdoor() */
export function okdoor(g: Grid, x: number, y: number): boolean {
  const t = g.get(x, y);
  return (
    (t === T.HWALL || t === T.VWALL) &&
    ((g.isok(x - 1, y) && !isObstructed(g.get(x - 1, y))) ||
      (g.isok(x + 1, y) && !isObstructed(g.get(x + 1, y))) ||
      (g.isok(x, y - 1) && !isObstructed(g.get(x, y - 1))) ||
      (g.isok(x, y + 1) && !isObstructed(g.get(x, y + 1)))) &&
    !bydoor(g, x, y)
  );
}

const inside = (r: IRoom, x: number, y: number): boolean =>
  x >= r.lx && x <= r.hx && y >= r.ly && y <= r.hy;

/**
 * ref: src/mklev.c good_rm_wall_doorpos() (needjoining is always true; no irregular rooms,
 * so finddpos_shift() reduces to this check)
 */
function goodDoorPos(g: Grid, x: number, y: number, dir: Dir, room: IRoom): boolean {
  if (!g.isok(x, y)) return false;
  const t = g.get(x, y);
  if (t !== T.HWALL && t !== T.VWALL && t !== T.DOOR && t !== T.SDOOR) return false;
  if (bydoor(g, x, y)) return false;
  const tx = x + INWARD[dir].x;
  const ty = y + INWARD[dir].y;
  if (!g.isok(tx, ty) || isObstructed(g.get(tx, ty))) return false;
  return inside(room, tx, ty);
}

/**
 * Find a valid door position on the preferred edge of a room; null when none exists.
 * ref: src/mklev.c finddpos()
 */
export function finddpos(g: Grid, rng: Rng, dir: Dir, room: IRoom): Pt | null {
  let x1: number, y1: number, x2: number, y2: number;
  switch (dir) {
    case 'N':
      [x1, x2, y1, y2] = [room.lx, room.hx, room.ly - 1, room.ly - 1];
      break;
    case 'S':
      [x1, x2, y1, y2] = [room.lx, room.hx, room.hy + 1, room.hy + 1];
      break;
    case 'W':
      [x1, x2, y1, y2] = [room.lx - 1, room.lx - 1, room.ly, room.hy];
      break;
    case 'E':
      [x1, x2, y1, y2] = [room.hx + 1, room.hx + 1, room.ly, room.hy];
      break;
  }
  // try random points
  for (let tryct = 0; tryct < 20; tryct++) {
    const x = x2 - x1 ? rng.rn2(x2 - x1 + 1) + x1 : x1;
    const y = y2 - y1 ? rng.rn2(y2 - y1 + 1) + y1 : y1;
    if (goodDoorPos(g, x, y, dir, room)) return { x, y };
  }
  // try all the points
  for (let x = x1; x <= x2; x++)
    for (let y = y1; y <= y2; y++) if (goodDoorPos(g, x, y, dir, room)) return { x, y };
  return null;
}

/**
 * Make a door at x,y.
 * ref: src/mklev.c dodoor() / dosdoor(). Deviations (DEVIATIONS.md): locked doors are closed
 * doors, trapped doors/mimics are never made.
 */
export function dodoor(g: Grid, rng: Rng, depth: number, x: number, y: number): void {
  const wasWall = isWall(g.get(x, y));
  const horiz = wasWall ? g.get(x, y) === T.HWALL : (g.getMask(x, y) & D_HORIZ) !== 0;
  // ref: mklev.c maybe_sdoor(8)
  const sdoor = depth > 2 && rng.rn2(8) === 0;
  let mask: number;
  if (sdoor && wasWall) {
    // ref: mklev.c dosdoor() SDOOR branch: locked (rn2(5)) or closed; both are D_CLOSED here
    rng.rn2(5);
    g.set(x, y, T.SDOOR);
    g.setMask(x, y, D_CLOSED | (horiz ? D_HORIZ : 0));
    return;
  } else if (rng.rn2(3) === 0) {
    if (rng.rn2(5) === 0) mask = D_ISOPEN;
    else mask = D_CLOSED; // D_LOCKED (rn2(6)) or D_CLOSED
  } else {
    mask = 0; // D_NODOOR
  }
  g.set(x, y, T.DOOR);
  g.setMask(x, y, mask | (horiz ? D_HORIZ : 0));
}

/**
 * Dig a corridor from org to dest. With nxcor it may stop at random (dead end).
 * ref: src/sp_lev.c dig_corridor(). Boulders are not generated. At depth > 2 each new corridor cell
 * is secret with chance 1/100 (maybe_sdoor(100)).
 */
export function digCorridor(
  g: Grid,
  rng: Rng,
  org: Pt,
  dest: Pt,
  nxcor: boolean,
  maxSteps: number,
  depth = 1,
): { ok: boolean; npoints: number } {
  const { colno: COLNO, rowno: ROWNO } = g;
  let npoints = 0;
  let xx = org.x;
  let yy = org.y;
  const tx = dest.x;
  const ty = dest.y;
  if (xx <= 0 || yy <= 0 || tx <= 0 || ty <= 0 || xx > COLNO - 1 || tx > COLNO - 1) {
    return { ok: false, npoints };
  }
  if (yy > ROWNO - 1 || ty > ROWNO - 1) return { ok: false, npoints };
  let dx = 0;
  let dy = 0;
  if (tx > xx) dx = 1;
  else if (ty > yy) dy = 1;
  else if (tx < xx) dx = -1;
  else dy = -1;

  xx -= dx;
  yy -= dy;
  let cct = 0;
  const passable = (t: number): boolean => t === T.STONE || t === T.CORR || t === T.SCORR;
  while (xx !== tx || yy !== ty) {
    if (cct++ > maxSteps || (nxcor && rng.rn2(35) === 0)) return { ok: false, npoints };
    xx += dx;
    yy += dy;
    if (xx >= COLNO - 1 || xx <= 0 || yy <= 0 || yy >= ROWNO - 1) return { ok: false, npoints };

    const here = g.get(xx, yy);
    if (here === T.STONE) {
      npoints++;
      // ref: sp_lev.c dig_corridor(): ftyp == CORR && maybe_sdoor(100)
      g.set(xx, yy, depth > 2 && rng.rn2(100) === 0 ? T.SCORR : T.CORR);
    } else if (here !== T.CORR && here !== T.SCORR) {
      return { ok: false, npoints }; // strange ...
    }

    // find next corridor position
    let dix = Math.abs(xx - tx);
    let diy = Math.abs(yy - ty);
    if (dix > diy && diy && rng.rn2(dix - diy + 1) === 0) {
      dix = 0;
    } else if (diy > dix && dix && rng.rn2(diy - dix + 1) === 0) {
      diy = 0;
    }

    // do we have to change direction?
    if (dy && dix > diy) {
      const ddx = xx > tx ? -1 : 1;
      if (passable(g.get(xx + ddx, yy))) {
        dx = ddx;
        dy = 0;
        continue;
      }
    } else if (dx && diy > dix) {
      const ddy = yy > ty ? -1 : 1;
      if (passable(g.get(xx, yy + ddy))) {
        dy = ddy;
        dx = 0;
        continue;
      }
    }

    // continue straight on?
    if (passable(g.get(xx + dx, yy + dy))) continue;

    // no, what must we do now??
    if (dx) {
      dx = 0;
      dy = ty < yy ? -1 : 1;
    } else {
      dy = 0;
      dx = tx < xx ? -1 : 1;
    }
    if (passable(g.get(xx + dx, yy + dy))) continue;
    dy = -dy;
    dx = -dx;
  }
  return { ok: true, npoints };
}

/** ref: src/mklev.c join() */
function join(g: Grid, rng: Rng, depth: number, a: number, b: number, nxcor: boolean): void {
  const croom = g.rooms[a] as IRoom;
  const troom = g.rooms[b] as IRoom;
  let dx: number, dy: number;
  let cc: Pt | null, tt: Pt | null;

  if (troom.lx > croom.hx) {
    dx = 1;
    dy = 0;
    cc = finddpos(g, rng, 'E', croom);
    tt = cc && finddpos(g, rng, 'W', troom);
  } else if (troom.hy < croom.ly) {
    dy = -1;
    dx = 0;
    cc = finddpos(g, rng, 'N', croom);
    tt = cc && finddpos(g, rng, 'S', troom);
  } else if (troom.hx < croom.lx) {
    dx = -1;
    dy = 0;
    cc = finddpos(g, rng, 'W', croom);
    tt = cc && finddpos(g, rng, 'E', troom);
  } else {
    dy = 1;
    dx = 0;
    cc = finddpos(g, rng, 'S', croom);
    tt = cc && finddpos(g, rng, 'N', troom);
  }
  if (!cc || !tt) return;
  if (nxcor && g.get(cc.x + dx, cc.y + dy) !== T.STONE) return;

  const org = { x: cc.x + dx, y: cc.y + dy };
  const dest = { x: tt.x - dx, y: tt.y - dy };
  // Deviation: the 500-step cap is scaled up for maps much larger than 80x21.
  const maxSteps = Math.max(500, 2 * (g.colno + g.rowno));
  const res = digCorridor(g, rng, org, dest, nxcor, maxSteps, depth);

  // we created at least 1 tile of corridor, even if it failed
  if (res.npoints > 0 && (okdoor(g, cc.x, cc.y) || !nxcor)) dodoor(g, rng, depth, cc.x, cc.y);
  if (!res.ok) return;

  // we succeeded in digging the corridor
  if (okdoor(g, tt.x, tt.y) || !nxcor) dodoor(g, rng, depth, tt.x, tt.y);

  const sa = g.smeq[a] as number;
  const sb = g.smeq[b] as number;
  if (sa < sb) g.smeq[b] = sa;
  else g.smeq[a] = sb;
}

/**
 * Create random corridors between rooms; rooms must be sorted.
 * ref: src/mklev.c makecorridors()
 */
export function makeCorridors(g: Grid, rng: Rng, depth: number): void {
  const nroom = g.rooms.length;
  const smeq = g.smeq;
  for (let a = 0; a < nroom - 1; a++) {
    join(g, rng, depth, a, a + 1, false);
    if (rng.rn2(50) === 0) break; // allow some randomness
  }
  for (let a = 0; a < nroom - 2; a++) {
    if (smeq[a] !== smeq[a + 2]) join(g, rng, depth, a, a + 2, false);
  }
  let any = true;
  for (let a = 0; any && a < nroom; a++) {
    any = false;
    for (let b = 0; b < nroom; b++) {
      if (smeq[a] !== smeq[b]) {
        join(g, rng, depth, a, b, false);
        any = true;
      }
    }
  }
  // add some extra corridors which may be blocked off
  if (nroom > 2) {
    for (let i = rng.rn2(nroom) + 4; i; i--) {
      const a = rng.rn2(nroom);
      let b = rng.rn2(nroom - 2);
      if (b >= a) b += 2;
      join(g, rng, depth, a, b, true);
    }
  }
}

const NB: readonly Pt[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Secret doors and corridors count: the hero can find them by searching. */
const walkable = (t: number): boolean =>
  t === T.DOOR || t === T.CORR || t === T.ROOM || t === T.SDOOR || t === T.SCORR;

/**
 * Flood fill over 4-connected walkable cells; returns the component label of every cell (-1 = none).
 * Walkable cells never touch the array border (rooms and corridors keep a 1-cell margin), so neighbour
 * indices need no bounds checks.
 */
function labelComponents(g: Grid): Int32Array {
  const label = new Int32Array(g.colno * g.rowno).fill(-1);
  const typ = g.typ;
  const offs = [-g.colno, 1, g.colno, -1];
  const stack: number[] = [];
  let next = 0;
  for (const room of g.rooms) {
    const start = g.idx(room.lx, room.ly);
    if ((label[start] as number) >= 0) continue;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop() as number;
      for (let k = 0; k < 4; k++) {
        const ni = c + (offs[k] as number);
        if ((label[ni] as number) < 0 && walkable(typ[ni] as number)) {
          label[ni] = next;
          stack.push(ni);
        }
      }
    }
    next++;
  }
  return label;
}

/** Wall cells of a room where a door could still go, with the stone/corridor cell outside each. */
function doorCandidates(g: Grid, room: IRoom, out: Map<number, Pt>): void {
  const edge = (wx: number, wy: number, ox: number, oy: number): void => {
    if (!okdoor(g, wx, wy)) return;
    if (ox < 1 || oy < 1 || ox > g.colno - 2 || oy > g.rowno - 2) return;
    const t = g.get(ox, oy);
    if ((t === T.STONE || t === T.CORR || t === T.SCORR) && !out.has(g.idx(ox, oy))) {
      out.set(g.idx(ox, oy), { x: wx, y: wy });
    }
  };
  for (let x = room.lx; x <= room.hx; x++) {
    edge(x, room.ly - 1, x, room.ly - 2);
    edge(x, room.hy + 1, x, room.hy + 2);
  }
  for (let y = room.ly; y <= room.hy; y++) {
    edge(room.lx - 1, y, room.lx - 2, y);
    edge(room.hx + 1, y, room.hx + 2, y);
  }
}

/** Open a plain doorway (no RNG) in the wall at p. */
function makeDoorway(g: Grid, p: Pt): void {
  const horiz = g.get(p.x, p.y) === T.HWALL;
  g.set(p.x, p.y, T.DOOR);
  g.setMask(p.x, p.y, horiz ? D_HORIZ : 0);
}

/** Dig the shortest stone/corridor path from `room` to any room of component `main`. */
function connectOne(g: Grid, room: IRoom, label: Int32Array, main: number): void {
  const sources = new Map<number, Pt>();
  doorCandidates(g, room, sources);
  const targets = new Map<number, Pt>();
  for (const r of g.rooms) {
    if ((label[g.idx(r.lx, r.ly)] as number) === main) doorCandidates(g, r, targets);
  }
  const parent = new Int32Array(g.colno * g.rowno).fill(-1);
  const queue: number[] = [];
  for (const s of sources.keys()) {
    parent[s] = s;
    queue.push(s);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi] as number;
    if (targets.has(c)) {
      let root = c;
      while ((parent[root] as number) !== root) {
        g.typ[root] = T.CORR;
        root = parent[root] as number;
      }
      g.typ[root] = T.CORR;
      makeDoorway(g, sources.get(root) as Pt);
      makeDoorway(g, targets.get(c) as Pt);
      return;
    }
    const cx = c % g.colno;
    const cy = (c - cx) / g.colno;
    for (const n of NB) {
      const nx = cx + n.x;
      const ny = cy + n.y;
      if (nx < 1 || ny < 1 || nx > g.colno - 2 || ny > g.rowno - 2) continue;
      const ni = g.idx(nx, ny);
      const t = g.typ[ni] as number;
      if ((parent[ni] as number) === -1 && (t === T.STONE || t === T.CORR || t === T.SCORR)) {
        parent[ni] = c;
        queue.push(ni);
      }
    }
  }
  throw new Error('levelgen: unable to connect all rooms');
}

/**
 * Guarantee that every room can reach every other room.
 * Deviation (DEVIATIONS.md): NetHack can leave rooms disconnected (e.g. when forced joins fail);
 * we add a deterministic shortest corridor (breadth-first, no RNG) with plain doorways.
 */
export function ensureConnected(g: Grid): void {
  for (;;) {
    const label = labelComponents(g);
    const first = g.rooms[0];
    if (!first) return;
    const main = label[g.idx(first.lx, first.ly)] as number;
    const stray = g.rooms.find((r) => (label[g.idx(r.lx, r.ly)] as number) !== main);
    if (!stray) return;
    connectOne(g, stray, label, main);
  }
}
