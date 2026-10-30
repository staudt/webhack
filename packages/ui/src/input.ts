export const TAP_MAX_MOVE = 10;
export const TAP_MAX_MS = 500;

function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * Keydown listener on `doc`; ignores alt/meta and focus in inputs. Ctrl keys are passed on too
 * (the handler decides: only `Ctrl+<key>` bindings act, so browser shortcuts stay untouched).
 */
export function attachKeys(doc: Document, handler: (e: KeyboardEvent) => boolean): () => void {
  const fn = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.altKey || ke.metaKey) return;
    if (inEditable(ke.target)) return;
    if (handler(ke)) ke.preventDefault();
  };
  doc.addEventListener('keydown', fn);
  return () => doc.removeEventListener('keydown', fn);
}

/** Keyup listener on `doc` (no filtering, so releases are never missed). Returns detach. */
export function attachKeyUp(doc: Document, handler: (e: KeyboardEvent) => void): () => void {
  const fn = (e: Event): void => handler(e as KeyboardEvent);
  doc.addEventListener('keyup', fn);
  return () => doc.removeEventListener('keyup', fn);
}

/**
 * Pointer tap detection (moved < 10px and < 500ms). A second finger down cancels the tap, and
 * nothing taps until every finger is up again, so a pinch is never a tap. Returns detach.
 */
export function attachTap(
  el: HTMLElement,
  onTap: (clientX: number, clientY: number) => void,
): () => void {
  let start: { x: number; y: number; t: number; id: number } | null = null;
  const down = new Set<number>();
  const onDown = (e: Event): void => {
    const p = e as PointerEvent;
    down.add(p.pointerId);
    start = down.size === 1 ? { x: p.clientX, y: p.clientY, t: Date.now(), id: p.pointerId } : null;
  };
  const up = (e: Event): void => {
    const p = e as PointerEvent;
    down.delete(p.pointerId);
    const s = start;
    start = null;
    if (!s || s.id !== p.pointerId) return;
    const moved = Math.hypot(p.clientX - s.x, p.clientY - s.y);
    if (moved < TAP_MAX_MOVE && Date.now() - s.t < TAP_MAX_MS) onTap(p.clientX, p.clientY);
  };
  const cancel = (e: Event): void => {
    down.delete((e as PointerEvent).pointerId);
    start = null;
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}

export interface PinchHandlers {
  /** Two fingers just went down. */
  onStart(): void;
  /** `scale` is the current finger distance over the starting distance. */
  onScale(scale: number): void;
  onEnd(): void;
}

/** Two-finger pinch detection on pointer events. Returns detach. */
export function attachPinch(el: HTMLElement, h: PinchHandlers): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let startDist = 0;
  let active = false;
  const d = (): number => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const down = (e: Event): void => {
    const p = e as PointerEvent;
    pts.set(p.pointerId, { x: p.clientX, y: p.clientY });
    if (pts.size === 2 && !active) {
      startDist = d();
      active = startDist > 0;
      if (active) h.onStart();
    }
  };
  const move = (e: Event): void => {
    const p = e as PointerEvent;
    if (!pts.has(p.pointerId)) return;
    pts.set(p.pointerId, { x: p.clientX, y: p.clientY });
    if (active && pts.size === 2) h.onScale(d() / startDist);
  };
  const end = (e: Event): void => {
    pts.delete((e as PointerEvent).pointerId);
    if (active && pts.size < 2) {
      active = false;
      h.onEnd();
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
  };
}
