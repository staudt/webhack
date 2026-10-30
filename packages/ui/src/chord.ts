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

type Cardinal = 'n' | 's' | 'e' | 'w';

/** The direction a command carries: a `move`, or a mod action whose `args.dir` is a direction. */
export function dirOf(cmd: UiCommand): string | null {
  if (cmd.type !== 'action') return null;
  const a = cmd.action;
  if (a.type === 'move') return a.dir;
  if (a.type !== 'mod') return null;
  const dir = (a.args as { dir?: unknown } | undefined)?.dir;
  return typeof dir === 'string' ? dir : null;
}

/** The cardinal direction of a movement command (a move, or e.g. a run), or null otherwise. */
function cardinal(cmd: UiCommand): Cardinal | null {
  const d = dirOf(cmd);
  return d === 'n' || d === 's' || d === 'e' || d === 'w' ? d : null;
}

/** The same command in another direction (`cmd` must have one). */
function withDir(cmd: UiCommand, dir: Dir): UiCommand {
  if (cmd.type !== 'action') return cmd;
  const a = cmd.action;
  if (a.type === 'move') return { type: 'action', action: { type: 'move', dir } };
  if (a.type === 'mod' && a.args && typeof a.args === 'object' && !Array.isArray(a.args))
    return { type: 'action', action: { ...a, args: { ...a.args, dir } } };
  return cmd;
}

const vertical = (d: string): boolean => d === 'n' || d === 's';

/** Combines two perpendicular cardinals into a diagonal (n+e = ne, ...). */
const combine = (a: Cardinal, b: Cardinal): Dir => (vertical(a) ? a + b : b + a) as Dir;

interface Pending {
  code: string;
  dir: Cardinal;
  cmd: UiCommand;
}

/**
 * Lets a quick pair of arrow presses make a diagonal (for moves, and for Shift+arrow runs). A fresh press waits `windowMs`
 * for a perpendicular partner; releasing early does not dispatch (forgiving taps).
 * Auto-repeats never wait, so a single held arrow walks at the OS repeat rate.
 */
export function createChord(opts: ChordOptions): Chord {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const held = new Map<string, Cardinal>();
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
  const heldPerpendicular = (d: Cardinal): Cardinal | undefined =>
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
        opts.dispatch(withDir(cmd, combine(dir, other)));
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
          opts.dispatch(withDir(cmd, combine(dir, partner)));
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
