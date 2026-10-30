import type { NhRect } from './rect';

/**
 * Internal working grid. Uses NetHack coordinates: x in 1..colno-1 (x = 0 unused), y in 0..rowno-1,
 * where colno = width + 1 and rowno = height. Output x = internal x - 1.
 * ref: include/rm.h levl[][], include/global.h COLNO ROWNO
 */
export const T = {
  STONE: 0,
  VWALL: 1,
  HWALL: 2,
  TLCORNER: 3,
  TRCORNER: 4,
  BLCORNER: 5,
  BRCORNER: 6,
  DOOR: 7,
  CORR: 8,
  ROOM: 9,
} as const;

/** Door state bits (ref: include/rm.h D_NODOOR D_ISOPEN D_CLOSED). 0 = no door. */
export const D_ISOPEN = 1;
export const D_CLOSED = 2;
/** Door sits in a horizontal wall (ref: rm.h levl[x][y].horizontal). */
export const D_HORIZ = 4;

/** ref: include/rm.h IS_WALL() (includes corners, excludes stone) */
export const isWall = (t: number): boolean => t >= T.VWALL && t <= T.BRCORNER;
/** ref: include/rm.h IS_OBSTRUCTED() for the types we have: stone and walls */
export const isObstructed = (t: number): boolean => t <= T.BRCORNER;

/** A room in internal coordinates; ref: include/mkroom.h struct mkroom */
export interface IRoom extends NhRect {
  lit: boolean;
}

export class Grid {
  readonly colno: number;
  readonly rowno: number;
  readonly typ: Uint8Array;
  readonly dmask: Uint8Array;
  readonly lit: Uint8Array;
  rooms: IRoom[] = [];
  smeq: number[] = [];

  constructor(width: number, height: number) {
    this.colno = width + 1;
    this.rowno = height;
    this.typ = new Uint8Array(this.colno * this.rowno);
    this.dmask = new Uint8Array(this.colno * this.rowno);
    this.lit = new Uint8Array(this.colno * this.rowno);
  }

  idx(x: number, y: number): number {
    return y * this.colno + x;
  }

  /** ref: include/hack.h isok() */
  isok(x: number, y: number): boolean {
    return x >= 1 && x <= this.colno - 1 && y >= 0 && y <= this.rowno - 1;
  }

  get(x: number, y: number): number {
    return this.typ[this.idx(x, y)] as number;
  }

  set(x: number, y: number, t: number): void {
    this.typ[this.idx(x, y)] = t;
  }

  getMask(x: number, y: number): number {
    return this.dmask[this.idx(x, y)] as number;
  }

  setMask(x: number, y: number, m: number): void {
    this.dmask[this.idx(x, y)] = m;
  }
}
