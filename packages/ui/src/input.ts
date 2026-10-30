export const TAP_MAX_MOVE = 10;
export const TAP_MAX_MS = 500;

function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Keydown listener on `doc`; ignores ctrl/alt/meta and focus in inputs. Returns detach. */
export function attachKeys(doc: Document, handler: (e: KeyboardEvent) => boolean): () => void {
  const fn = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.ctrlKey || ke.altKey || ke.metaKey) return;
    if (inEditable(ke.target)) return;
    if (handler(ke)) ke.preventDefault();
  };
  doc.addEventListener('keydown', fn);
  return () => doc.removeEventListener('keydown', fn);
}

/** Pointer tap detection (moved < 10px and < 500ms). Returns detach. */
export function attachTap(
  el: HTMLElement,
  onTap: (clientX: number, clientY: number) => void,
): () => void {
  let start: { x: number; y: number; t: number; id: number } | null = null;
  const down = (e: Event): void => {
    const p = e as PointerEvent;
    start = { x: p.clientX, y: p.clientY, t: Date.now(), id: p.pointerId };
  };
  const up = (e: Event): void => {
    const p = e as PointerEvent;
    const s = start;
    start = null;
    if (!s || s.id !== p.pointerId) return;
    const moved = Math.hypot(p.clientX - s.x, p.clientY - s.y);
    if (moved < TAP_MAX_MOVE && Date.now() - s.t < TAP_MAX_MS) onTap(p.clientX, p.clientY);
  };
  const cancel = (): void => {
    start = null;
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
