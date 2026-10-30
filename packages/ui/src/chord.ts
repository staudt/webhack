import type { Dir, UiCommand } from '@nh/core';

/** Physical arrow keys (`e.code`); numpad keys report other codes and are never chorded. */
export const ARROW_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export const DEFAULT_CHORD_MS = 100;

export interface ChordOptions {
  /** Pending window in ms; 0 disables chording (everything dispatches immediately). */
  windowMs: number;
  dispatch(cmd: UiCommand): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface Chord {
  /** A keydown of an arrow, already resolved through the keymap (`cmd`). */
  down(code: string, repeat: boolean, cmd: UiCommand): void;
  up(code: string): void;
  /** Forget held keys and drop the pending one without moving (blur, modal open, destroy). */
  reset(): void;
}

const move = (dir: Dir): UiCommand => ({ type: 'action', action: { type: 'move', dir } });

/** The cardinal direction of a `move` command, or null for anything else. */
function cardinal(cmd: UiCommand): 'n' | 's' | 'e' | 'w' | null {
  if (cmd.type !== 'action' || cmd.action.type !== 'move') return null;
  const d = cmd.action.dir;
  return d === 'n' || d === 's' || d === 'e' || d === 'w' ? d : null;
}

const vertical = (d: string): boolean => d === 'n' || d === 's';

/** Combines two perpendicular cardinals into a diagonal (n+e = ne, ...). */
const combine = (a: 'n' | 's' | 'e' | 'w', b: 'n' | 's' | 'e' | 'w'): Dir =>
  (vertical(a) ? a + b : b + a) as Dir;

interface Pending {
  code: string;
  dir: 'n' | 's' | 'e' | 'w';
  cmd: UiCommand;
}

/**
 * Lets a quick pair of arrow presses make a diagonal. A fresh press waits `windowMs`
 * for a perpendicular partner; releasing early does not dispatch (forgiving taps).
 * Auto-repeats never wait, so a single held arrow walks at the OS repeat rate.
 */
export function createChord(opts: ChordOptions): Chord {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const held = new Map<string, 'n' | 's' | 'e' | 'w'>();
  let pending: Pending | null = null;
  let timer: unknown = null;

  const drop = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending = null;
  };
  const flush = (): void => {
    const p = pending;
    drop();
    if (p) opts.dispatch(p.cmd);
  };
  const heldPerpendicular = (d: 'n' | 's' | 'e' | 'w'): 'n' | 's' | 'e' | 'w' | undefined =>
    [...held.values()].find((h) => vertical(h) !== vertical(d));

  return {
    down(code, repeat, cmd) {
      const dir = cardinal(cmd);
      if (dir === null || opts.windowMs <= 0) {
        if (pending?.code === code) drop();
        opts.dispatch(cmd);
        return;
      }
      held.set(code, dir);
      if (repeat && pending?.code === code) drop();
      const other = heldPerpendicular(dir);
      if (other) {
        // The partner may itself still be pending; the diagonal replaces it.
        if (pending && vertical(pending.dir) !== vertical(dir)) drop();
        opts.dispatch(move(combine(dir, other)));
        return;
      }
      if (repeat) {
        opts.dispatch(cmd);
        return;
      }
      if (pending) {
        if (vertical(pending.dir) !== vertical(dir)) {
          const partner = pending.dir;
          drop();
          opts.dispatch(move(combine(dir, partner)));
          return;
        }
        flush();
      }
      pending = { code, dir, cmd };
      timer = setTimer(flush, opts.windowMs);
    },
    up(code) {
      held.delete(code);
    },
    reset() {
      held.clear();
      drop();
    },
  };
}
