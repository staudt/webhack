/** Pure pinch-zoom math. No DOM. */

/** Cell width bounds in CSS px for pinch zoom. */
export const MIN_CELL_PX = 4;
export const MAX_CELL_PX = 48;

export const clampCell = (cell: number, min = MIN_CELL_PX, max = MAX_CELL_PX): number =>
  Math.min(max, Math.max(min, cell));

/** Distance between two points. */
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The cell width after a pinch that began with the fingers `startDist` apart on cells of
 * `startCell` px and now has them `curDist` apart. Rounded to 0.5 px and clamped.
 */
export function pinchCell(
  startCell: number,
  startDist: number,
  curDist: number,
  min = MIN_CELL_PX,
  max = MAX_CELL_PX,
): number {
  if (!(startDist > 0) || !(curDist > 0)) return clampCell(startCell, min, max);
  return clampCell(Math.round(startCell * (curDist / startDist) * 2) / 2, min, max);
}
