import type { Rng } from '../types/rng';

/** ref: include/sp_lev.h NhRect */
export interface NhRect {
  lx: number;
  ly: number;
  hx: number;
  hy: number;
}

// ref: src/rect.c
export const XLIM = 4;
export const YLIM = 3;

/**
 * Free-rectangle list used for room placement.
 * ref: src/rect.c (the C version keeps static globals; this is an instance per level).
 * Stored as four parallel Int32Arrays (structure of arrays) because the linear scans dominate
 * generation time on very large maps.
 */
export class RectList {
  private readonly lx: Int32Array;
  private readonly ly: Int32Array;
  private readonly hx: Int32Array;
  private readonly hy: Int32Array;
  private count = 0;
  private readonly maxRects: number;

  constructor(
    private readonly colno: number,
    private readonly rowno: number,
  ) {
    // ref: src/rect.c init_rect(): n_rects = (COLNO * ROWNO) / 30. Already scales with map area.
    this.maxRects = Math.max(1, Math.floor((colno * rowno) / 30));
    this.lx = new Int32Array(this.maxRects);
    this.ly = new Int32Array(this.maxRects);
    this.hx = new Int32Array(this.maxRects);
    this.hy = new Int32Array(this.maxRects);
    this.push(0, 0, colno - 1, rowno - 1);
  }

  get size(): number {
    return this.count;
  }

  /** Snapshot of the list (tests, debugging). */
  toArray(): NhRect[] {
    return Array.from({ length: this.count }, (_, i) => this.at(i));
  }

  private at(i: number): NhRect {
    return {
      lx: this.lx[i] as number,
      ly: this.ly[i] as number,
      hx: this.hx[i] as number,
      hy: this.hy[i] as number,
    };
  }

  private push(lx: number, ly: number, hx: number, hy: number): void {
    this.lx[this.count] = lx;
    this.ly[this.count] = ly;
    this.hx[this.count] = hx;
    this.hy[this.count] = hy;
    this.count++;
  }

  /** ref: src/rect.c get_rect_ind() */
  private indexOf(r: NhRect): number {
    for (let i = 0; i < this.count; i++) {
      if (
        this.lx[i] === r.lx &&
        this.ly[i] === r.ly &&
        this.hx[i] === r.hx &&
        this.hy[i] === r.hy
      ) {
        return i;
      }
    }
    return -1;
  }

  /** Search a free rectangle that includes the one given. ref: src/rect.c get_rect() */
  find(r: NhRect): NhRect | null {
    for (let i = 0; i < this.count; i++) {
      if (
        r.lx >= (this.lx[i] as number) &&
        r.ly >= (this.ly[i] as number) &&
        r.hx <= (this.hx[i] as number) &&
        r.hy <= (this.hy[i] as number)
      ) {
        return this.at(i);
      }
    }
    return null;
  }

  /** Random rectangle from the list, or null. ref: src/rect.c rnd_rect() */
  rnd(rng: Rng): NhRect | null {
    return this.count > 0 ? this.at(rng.rn2(this.count)) : null;
  }

  /** ref: src/rect.c remove_rect() */
  remove(r: NhRect): void {
    const ind = this.indexOf(r);
    if (ind < 0) return;
    const last = --this.count;
    this.lx[ind] = this.lx[last] as number;
    this.ly[ind] = this.ly[last] as number;
    this.hx[ind] = this.hx[last] as number;
    this.hy[ind] = this.hy[last] as number;
  }

  /** ref: src/rect.c add_rect() */
  add(r: NhRect): void {
    if (this.count >= this.maxRects) return; // C: impossible("n_rects may be too small.")
    if (this.find(r)) return; // already included in another rectangle
    this.push(r.lx, r.ly, r.hx, r.hy);
  }

  /**
   * r1 was in the list and r2 is included in it: carve r2 out of r1 (and any other rect it overlaps).
   * ref: src/rect.c split_rects()
   */
  split(r1: NhRect, r2: NhRect): void {
    const old = { ...r1 };
    this.remove(r1);

    // Walk down since the list changes. The C code may read stale slots when the list shrinks
    // during recursion; here such indices are simply skipped.
    for (let i = this.count - 1; i >= 0; i--) {
      if (i >= this.count) continue;
      // cheap reject before building the intersection
      if (
        r2.lx > (this.hx[i] as number) ||
        r2.ly > (this.hy[i] as number) ||
        r2.hx < (this.lx[i] as number) ||
        r2.hy < (this.ly[i] as number)
      ) {
        continue;
      }
      const cur = this.at(i);
      const r = intersect(cur, r2);
      if (r) this.split(cur, r);
    }

    const { rowno, colno } = this;
    if (r2.ly - old.ly - 1 > (old.hy < rowno - 1 ? 2 * YLIM : YLIM + 1) + 4) {
      this.add({ ...old, hy: r2.ly - 2 });
    }
    if (r2.lx - old.lx - 1 > (old.hx < colno - 1 ? 2 * XLIM : XLIM + 1) + 4) {
      this.add({ ...old, hx: r2.lx - 2 });
    }
    if (old.hy - r2.hy - 1 > (old.ly > 0 ? 2 * YLIM : YLIM + 1) + 4) {
      this.add({ ...old, ly: r2.hy + 2 });
    }
    if (old.hx - r2.hx - 1 > (old.lx > 0 ? 2 * XLIM : XLIM + 1) + 4) {
      this.add({ ...old, lx: r2.hx + 2 });
    }
  }
}

/** ref: src/rect.c intersect() */
function intersect(r1: NhRect, r2: NhRect): NhRect | null {
  if (r2.lx > r1.hx || r2.ly > r1.hy || r2.hx < r1.lx || r2.hy < r1.ly) return null;
  const r3 = {
    lx: Math.max(r1.lx, r2.lx),
    ly: Math.max(r1.ly, r2.ly),
    hx: Math.min(r1.hx, r2.hx),
    hy: Math.min(r1.hy, r2.hy),
  };
  if (r3.lx > r3.hx || r3.ly > r3.hy) return null;
  return r3;
}
