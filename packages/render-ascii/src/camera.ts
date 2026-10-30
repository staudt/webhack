/** Pure camera math. No DOM. Units are map cells (fractional). */

export interface CameraState {
  /** Top-left of the viewport in fractional cell units. */
  x: number;
  y: number;
}
export interface ViewSize {
  /** Viewport size in (fractional) cells. */
  cols: number;
  rows: number;
}
export interface MapSize {
  width: number;
  height: number;
}
export interface DeadZone {
  /** Inset in cells from each horizontal / vertical viewport edge. */
  x: number;
  y: number;
}
export interface CellRange {
  /** Inclusive start, exclusive end. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Inset = max(2, 25% of the axis), capped so the zone never inverts. */
export function deadZoneFor(view: ViewSize): DeadZone {
  const inset = (n: number): number => Math.max(0, Math.min(Math.max(2, n * 0.25), (n - 1) / 2));
  return { x: inset(view.cols), y: inset(view.rows) };
}

function clampAxis(v: number, mapLen: number, viewLen: number): number {
  if (mapLen <= viewLen) return (mapLen - viewLen) / 2;
  return Math.min(Math.max(v, 0), mapLen - viewLen);
}

/** Keep the camera inside the map; center on axes where the map is smaller than the view. */
export function clampToMap(cam: CameraState, map: MapSize, view: ViewSize): CameraState {
  return { x: clampAxis(cam.x, map.width, view.cols), y: clampAxis(cam.y, map.height, view.rows) };
}

function followAxis(cam: number, p: number, viewLen: number, inset: number): number {
  if (p < cam + inset) return p - inset;
  if (p + 1 > cam + viewLen - inset) return p + 1 - viewLen + inset;
  return cam;
}

/**
 * Target camera: unchanged while the player cell is inside the dead zone, otherwise moved
 * just enough to bring it back; then clamped to the map.
 */
export function computeTarget(
  cam: CameraState,
  player: { x: number; y: number },
  map: MapSize,
  view: ViewSize,
  deadZone: DeadZone,
): CameraState {
  return clampToMap(
    {
      x: followAxis(cam.x, player.x, view.cols, deadZone.x),
      y: followAxis(cam.y, player.y, view.rows, deadZone.y),
    },
    map,
    view,
  );
}

const SNAP = 0.01;
const RATE = 12;

/** Exponential approach to target; snaps per axis when within 0.01 cell. */
export function stepCamera(
  current: CameraState,
  target: CameraState,
  dtSeconds: number,
): CameraState {
  const f = 1 - Math.exp(-Math.max(0, dtSeconds) * RATE);
  const axis = (c: number, t: number): number => {
    const d = t - c;
    return Math.abs(d) < SNAP ? t : c + d * f;
  };
  return { x: axis(current.x, target.x), y: axis(current.y, target.y) };
}

/** Map cells at least partially inside the viewport, clamped to the map. */
export function visibleRange(cam: CameraState, view: ViewSize, map: MapSize): CellRange {
  return {
    x0: Math.max(0, Math.floor(cam.x)),
    x1: Math.min(map.width, Math.ceil(cam.x + view.cols)),
    y0: Math.max(0, Math.floor(cam.y)),
    y1: Math.min(map.height, Math.ceil(cam.y + view.rows)),
  };
}
