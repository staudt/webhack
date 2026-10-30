import type { Rng } from '../types/rng';
import { Grid, T } from './grid';
import { RectList, XLIM, YLIM, type NhRect } from './rect';

/** ref: include/global.h MAXNROFROOMS (40) scaled by map area vs 80x21. See DEVIATIONS.md. */
export function maxRooms(width: number, height: number): number {
  return Math.max(40, Math.floor((40 * width * height) / (80 * 21)));
}

/** ref: src/mkmap.c litstate_rnd() with litstate < 0 */
export function litstateRnd(rng: Rng, depth: number): boolean {
  return rng.rnd(1 + Math.abs(depth)) < 11 && rng.rn2(77) !== 0;
}

interface RoomBox {
  lowx: number;
  ddx: number;
  lowy: number;
  ddy: number;
}

/**
 * Shrink/shift a candidate room until it fits in stone, or give up.
 * ref: src/sp_lev.c check_room() (non-vault, non-themeroom path)
 */
function checkRoom(g: Grid, rng: Rng, box: RoomBox): RoomBox | null {
  const { colno: COLNO, rowno: ROWNO } = g;
  let { lowx, lowy } = box;
  let hix = lowx + box.ddx;
  let hiy = lowy + box.ddy;
  if (lowx < 3) lowx = 3;
  if (lowy < 2) lowy = 2;
  if (hix > COLNO - 3) hix = COLNO - 3;
  if (hiy > ROWNO - 3) hiy = ROWNO - 3;
  for (;;) {
    if (hix <= lowx || hiy <= lowy) return null;
    let retry = false;
    scan: for (let x = lowx - XLIM; x <= hix + XLIM; x++) {
      if (x <= 0 || x >= COLNO) continue;
      const ymax = Math.min(hiy + YLIM, ROWNO - 1);
      for (let y = Math.max(lowy - YLIM, 0); y <= ymax; y++) {
        if (g.get(x, y) === T.STONE) continue;
        if (rng.rn2(3) === 0) return null;
        if (x < lowx) lowx = x + XLIM + 1;
        else hix = x - XLIM - 1;
        if (y < lowy) lowy = y + YLIM + 1;
        else hiy = y - YLIM - 1;
        retry = true;
        break scan; // C: goto chk
      }
    }
    if (!retry) return { lowx, ddx: hix - lowx, lowy, ddy: hiy - lowy };
  }
}

/**
 * Draw walls, floor and lighting for a room. Rooms only (no subrooms, no "special" rooms).
 * ref: src/mklev.c do_room_or_subroom() / add_room()
 */
export function addRoom(
  g: Grid,
  lowx: number,
  lowy: number,
  hix: number,
  hiy: number,
  lit: boolean,
): void {
  if (!lowx) lowx++;
  if (!lowy) lowy++;
  if (hix >= g.colno - 1) hix = g.colno - 2;
  if (hiy >= g.rowno - 1) hiy = g.rowno - 2;

  if (lit) {
    for (let x = lowx - 1; x <= hix + 1; x++)
      for (let y = Math.max(lowy - 1, 0); y <= hiy + 1; y++) g.lit[g.idx(x, y)] = 1;
  }
  g.rooms.push({ lx: lowx, ly: lowy, hx: hix, hy: hiy, lit });

  for (let x = lowx - 1; x <= hix + 1; x++)
    for (let y = lowy - 1; y <= hiy + 1; y += hiy - lowy + 2) g.set(x, y, T.HWALL);
  for (let x = lowx - 1; x <= hix + 1; x += hix - lowx + 2)
    for (let y = lowy; y <= hiy; y++) g.set(x, y, T.VWALL);
  for (let x = lowx; x <= hix; x++) for (let y = lowy; y <= hiy; y++) g.set(x, y, T.ROOM);
  g.set(lowx - 1, lowy - 1, T.TLCORNER);
  g.set(hix + 1, lowy - 1, T.TRCORNER);
  g.set(lowx - 1, hiy + 1, T.BLCORNER);
  g.set(hix + 1, hiy + 1, T.BRCORNER);
}

/**
 * Try to create one random room from the free-rectangle list.
 * ref: src/sp_lev.c create_room() "totally random room" path (vaults and
 * fixed-position rooms are not generated)
 */
function createRoom(g: Grid, rects: RectList, rng: Rng, depth: number): boolean {
  const { colno: COLNO, rowno: ROWNO } = g;
  const rlit = litstateRnd(rng, depth);
  let trycnt = 0;
  do {
    const r1 = rects.rnd(rng);
    if (!r1) return false; // no more free rectangles
    const { hx, hy, lx, ly } = r1;
    const dx = 2 + rng.rn2(hx - lx > 28 ? 12 : 8);
    let dy = 2 + rng.rn2(4);
    if (dx * dy > 50) dy = Math.floor(50 / dx);
    const xborder = lx > 0 && hx < COLNO - 1 ? 2 * XLIM : XLIM + 1;
    const yborder = ly > 0 && hy < ROWNO - 1 ? 2 * YLIM : YLIM + 1;
    if (hx - lx < dx + 3 + xborder || hy - ly < dy + 3 + yborder) continue;
    const xabs = lx + (lx > 0 ? XLIM : 3) + rng.rn2(hx - (lx > 0 ? lx : 3) - dx - xborder + 1);
    let yabs = ly + (ly > 0 ? YLIM : 2) + rng.rn2(hy - (ly > 0 ? ly : 2) - dy - yborder + 1);
    let ddy = dy;
    const nroom = g.rooms.length;
    if (
      ly === 0 &&
      hy >= ROWNO - 1 &&
      (nroom === 0 || rng.rn2(nroom) === 0) &&
      yabs + dy > Math.floor(ROWNO / 2)
    ) {
      yabs = rng.rn2(3) + 2; // rn1(3, 2)
      if (nroom < 4 && dy > 1) ddy--;
    }
    const box = checkRoom(g, rng, { lowx: xabs, ddx: dx, lowy: yabs, ddy });
    if (!box) continue;
    const wtmp = box.ddx + 1;
    const htmp = box.ddy + 1;
    const r2: NhRect = {
      lx: box.lowx - 1,
      ly: box.lowy - 1,
      hx: box.lowx + wtmp,
      hy: box.lowy + htmp,
    };
    rects.split({ ...r1 }, r2);
    g.smeq[nroom] = nroom;
    addRoom(g, box.lowx, box.lowy, box.lowx + wtmp - 1, box.lowy + htmp - 1, rlit);
    return true;
  } while (++trycnt <= 100);
  return false;
}

/**
 * Make rooms until the rectangle list or the room cap is exhausted.
 * ref: src/mklev.c makerooms() (no themed rooms, no vault)
 */
export function makeRooms(g: Grid, rng: Rng, depth: number, maxRoomCount: number): void {
  const rects = new RectList(g.colno, g.rowno);
  while (g.rooms.length < maxRoomCount - 1 && rects.rnd(rng)) {
    if (!createRoom(g, rects, rng, depth)) break;
  }
}

/**
 * Order rooms left to right. Stable for equal lx (C qsort is unspecified there).
 * ref: src/mklev.c sort_rooms()
 */
export function sortRooms(g: Grid): void {
  g.rooms.sort((a, b) => a.lx - b.lx);
}
