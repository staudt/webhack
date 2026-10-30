import type { Glyph } from '@nh/core';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Surface = OffscreenCanvas | HTMLCanvasElement;

/** Dim (remembered, not visible) glyphs are rasterized at this alpha over the background. */
export const DIM_ALPHA = 0.45;

const SLOT_COLS = 32;
const SLOT_ROWS = 32;

export interface AtlasConfig {
  /** Cell size in device pixels. */
  slotW: number;
  slotH: number;
  dpr: number;
  font: string;
  /** Baseline offset from slot top, device px. */
}

/** Glyph cache on one offscreen sheet. Slots are filled lazily; on overflow the sheet resets. */
export class GlyphAtlas {
  private surface: Surface;
  private ctx: Ctx;
  private slots = new Map<string, number>();
  private next = 0;
  constructor(private cfg: AtlasConfig) {
    this.surface = makeSurface(cfg.slotW * SLOT_COLS, cfg.slotH * SLOT_ROWS);
    this.ctx = this.surface.getContext('2d') as Ctx;
  }

  clear(): void {
    this.slots.clear();
    this.next = 0;
    this.ctx.clearRect(0, 0, this.surface.width, this.surface.height);
  }

  /** Draw a glyph into the destination at CSS-pixel rect (dx, dy, w, h). */
  draw(
    dst: CanvasRenderingContext2D,
    g: Glyph,
    dim: boolean,
    dx: number,
    dy: number,
    w: number,
    h: number,
  ): void {
    if (g.ch === ' ' || g.ch === '') return;
    const slot = this.slotFor(g, dim);
    const { slotW, slotH } = this.cfg;
    const sx = (slot % SLOT_COLS) * slotW;
    const sy = Math.floor(slot / SLOT_COLS) * slotH;
    dst.drawImage(this.surface as CanvasImageSource, sx, sy, slotW, slotH, dx, dy, w, h);
  }

  private slotFor(g: Glyph, dim: boolean): number {
    const key = `${g.ch}\u0000${g.fg}\u0000${dim ? 1 : 0}`;
    const hit = this.slots.get(key);
    if (hit !== undefined) return hit;
    if (this.next >= SLOT_COLS * SLOT_ROWS) this.clear();
    const slot = this.next++;
    this.slots.set(key, slot);
    const { slotW, slotH, dpr, font } = this.cfg;
    const sx = (slot % SLOT_COLS) * slotW;
    const sy = Math.floor(slot / SLOT_COLS) * slotH;
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(sx, sy, slotW, slotH);
    c.clip();
    c.clearRect(sx, sy, slotW, slotH);
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = g.fg;
    c.globalAlpha = dim ? DIM_ALPHA : 1;
    // font is specified in device px (see renderer), so no extra scale is needed
    c.fillText(g.ch, sx + slotW / 2, sy + slotH / 2 + dpr * 0.5);
    c.restore();
    return slot;
  }
}

function makeSurface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
