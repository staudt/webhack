import type {
  DefId,
  Glyph,
  HTMLElementLike,
  Pos,
  Renderer,
  ViewCell,
  ViewEntity,
  ViewPlayer,
  ViewUpdate,
} from '@nh/core';
import {
  computeTarget,
  deadZoneFor,
  stepCamera,
  visibleRange,
  type CameraState,
  type MapSize,
  type ViewSize,
} from './camera';
import { GlyphAtlas } from './glyphAtlas';

export interface AsciiRendererOptions {
  fontFamily?: string;
  /** CSS px. Default: auto (see autoFontSize). */
  fontSizeCssPx?: number;
  /** Minimum cell width in CSS px (default 6). */
  minCellCssPx?: number;
  background?: string;
}

export type AsciiRenderer = Renderer & {
  readonly camera: CameraState;
  /** Set the cell width in CSS px; the font size is derived from it. */
  setZoom(cellCssPx: number): void;
};

const MISSING: Glyph = { ch: '?', fg: '#f0f' };
const DEFAULT_FONT = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
/** Cell height is fontSize * LINE (CSS px, ceil'd). */
const LINE = 1.2;

/**
 * Auto font size. Desktop (>= 768 css px wide): 16px. Narrower (phones): sized so roughly 27
 * columns fit (advance of a monospace glyph is ~0.6em): cssWidth / 27 / 0.6, clamped 14..24.
 */
export function autoFontSize(cssWidth: number): number {
  if (cssWidth >= 768) return 16;
  return Math.min(24, Math.max(14, Math.round(cssWidth / 27 / 0.6)));
}

/** The object glyph id to draw over a cell's terrain (under creatures), or null. */
export function objectLayer(c: ViewCell): DefId | null {
  return c.o ?? null;
}

/** The remembered monster glyph id to draw dimmed on a cell that is not in view now, or null. */
export function monsterLayer(c: ViewCell): DefId | null {
  return !c.v && c.m !== undefined ? c.m : null;
}

export function createAsciiRenderer(opts: AsciiRendererOptions = {}): AsciiRenderer {
  const fontFamily = opts.fontFamily ?? DEFAULT_FONT;
  const background = opts.background ?? '#000';
  const minCell = opts.minCellCssPx ?? 6;

  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let resizeObs: ResizeObserver | null = null;
  let mql: MediaQueryList | null = null;
  let atlas: GlyphAtlas | null = null;

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let fontSize = opts.fontSizeCssPx ?? 0; // 0 => auto
  let cellW = 10;
  let cellH = 20;

  // View mirror
  let width = 0;
  let height = 0;
  let cells: ViewCell[] = [];
  let entities: ViewEntity[] = [];
  let player: ViewPlayer | null = null;
  let baseLegend: Record<string, Glyph> = {};
  const overrides = new Map<string, Glyph>();

  // Camera
  let cam: CameraState = { x: 0, y: 0 };
  let target: CameraState = { x: 0, y: 0 };

  let dirty = false;
  let raf = 0;
  let lastTs = 0;

  const view = (): ViewSize => ({ cols: cssW / cellW, rows: cssH / cellH });
  const map = (): MapSize => ({ width, height });

  function glyphFor(id: DefId | string): Glyph {
    return overrides.get(id) ?? baseLegend[id] ?? MISSING;
  }

  function measure(): void {
    const size = fontSize > 0 ? fontSize : autoFontSize(cssW);
    const m = (ctx ?? document.createElement('canvas').getContext('2d'))!;
    m.save();
    m.font = `${size}px ${fontFamily}`;
    const adv = m.measureText('M').width;
    m.restore();
    cellW = Math.max(Math.ceil(minCell), Math.ceil(adv));
    cellH = Math.ceil(size * LINE);
    const px = size * dpr;
    atlas = new GlyphAtlas({
      slotW: Math.ceil(cellW * dpr),
      slotH: Math.ceil(cellH * dpr),
      dpr,
      font: `${px}px ${fontFamily}`,
    });
  }

  function retarget(jump: boolean): void {
    if (!player || width === 0) return;
    const v = view();
    target = computeTarget(jump ? { x: -1e9, y: -1e9 } : target, player, map(), v, deadZoneFor(v));
    if (jump) cam = { ...target };
  }

  function schedule(): void {
    dirty = true;
    if (raf || !canvas) return;
    raf = requestAnimationFrame(frame);
  }

  function frame(ts: number): void {
    raf = 0;
    if (!canvas || !ctx) return;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    const animating = cam.x !== target.x || cam.y !== target.y;
    if (animating) {
      cam = stepCamera(cam, target, dt);
      dirty = true;
    }
    if (dirty) {
      draw();
      dirty = false;
    }
    if (cam.x !== target.x || cam.y !== target.y) raf = requestAnimationFrame(frame);
    else lastTs = 0;
  }

  function draw(): void {
    if (!ctx || !atlas) return;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cssW, cssH);
    if (width === 0) return;
    // Snap the scroll offset to device pixels so glyphs stay crisp.
    const ox = Math.round(cam.x * cellW * dpr) / dpr;
    const oy = Math.round(cam.y * cellH * dpr) / dpr;
    const r = visibleRange(cam, view(), map());
    for (let y = r.y0; y < r.y1; y++) {
      const dy = y * cellH - oy;
      for (let x = r.x0; x < r.x1; x++) {
        const c = cells[y * width + x];
        if (!c || c.g === null) continue;
        const px = x * cellW - ox;
        const top = objectLayer(c);
        const mon = monsterLayer(c);
        if (mon !== null) {
          // A monster last seen here: its glyph, dimmed like a remembered object, on top of it.
          ctx.fillStyle = background;
          ctx.fillRect(px, dy, cellW, cellH);
          atlas.draw(ctx, glyphFor(mon), true, px, dy, cellW, cellH);
        } else if (top !== null) {
          // Objects replace the terrain glyph; dimmed when only remembered.
          ctx.fillStyle = background;
          ctx.fillRect(px, dy, cellW, cellH);
          atlas.draw(ctx, glyphFor(top), !c.v, px, dy, cellW, cellH);
        } else {
          atlas.draw(ctx, glyphFor(c.g), !c.v, px, dy, cellW, cellH);
        }
      }
    }
    for (const e of entities) {
      if (e.x < r.x0 || e.x >= r.x1 || e.y < r.y0 || e.y >= r.y1) continue;
      const dx = e.x * cellW - ox;
      const dy = e.y * cellH - oy;
      ctx.fillStyle = background;
      ctx.fillRect(dx, dy, cellW, cellH);
      atlas.draw(ctx, glyphFor(e.g), false, dx, dy, cellW, cellH);
    }
  }

  function layout(): void {
    if (!host || !canvas || !ctx) return;
    const rect = host.getBoundingClientRect();
    cssW = Math.max(1, Math.floor(rect.width || host.clientWidth));
    cssH = Math.max(1, Math.floor(rect.height || host.clientHeight));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'middle';
    measure();
    // Re-target from the current camera so the player stays in view.
    retarget(false);
    cam = { ...target };
    schedule();
  }

  function watchDpr(): void {
    mql?.removeEventListener('change', onDprChange);
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mql.addEventListener('change', onDprChange);
  }
  function onDprChange(): void {
    watchDpr();
    layout();
  }

  const api: AsciiRenderer = {
    get camera(): CameraState {
      return cam;
    },
    mount(el: HTMLElementLike): void {
      if (canvas) api.destroy();
      host = el as HTMLElement;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
      host.appendChild(canvas);
      ctx = canvas.getContext('2d');
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(() => layout());
        resizeObs.observe(host);
      }
      watchDpr();
      layout();
    },
    apply(u: ViewUpdate): void {
      if (u.kind === 'full') {
        width = u.width;
        height = u.height;
        cells = u.cells.slice();
        entities = u.entities;
        player = u.player;
        baseLegend = u.legend;
        if (ctx) {
          retarget(true);
          target = { ...cam };
        }
      } else {
        if (width === 0) return;
        for (const [i, c] of u.cells) cells[i] = c;
        entities = u.entities;
        player = u.player;
        retarget(false);
      }
      schedule();
    },
    setGlyph(id: DefId, glyph: Glyph): void {
      overrides.set(id, glyph);
      atlas?.clear();
      schedule();
    },
    cellAt(clientX: number, clientY: number): Pos | null {
      if (!canvas || width === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / cellW + cam.x);
      const y = Math.floor((clientY - rect.top) / cellH + cam.y);
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { x, y };
    },
    resize(): void {
      layout();
    },
    setZoom(cellCssPx: number): void {
      if (!ctx) return;
      ctx.save();
      ctx.font = `100px ${fontFamily}`;
      const ratio = ctx.measureText('M').width / 100 || 0.6;
      ctx.restore();
      fontSize = Math.max(4, cellCssPx / ratio);
      layout();
    },
    destroy(): void {
      resizeObs?.disconnect();
      resizeObs = null;
      mql?.removeEventListener('change', onDprChange);
      mql = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas?.remove();
      canvas = null;
      ctx = null;
      host = null;
      atlas = null;
    },
  };
  return api;
}
