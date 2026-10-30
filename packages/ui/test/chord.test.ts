import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ClientApi, UiCommand } from '@nh/core';
import { createChord } from '../src/chord';
import { Keymap, defaultKeymap } from '../src/keymap';

function setup(windowMs = 100, rebind?: (km: Keymap) => void) {
  const km = new Keymap();
  defaultKeymap.register({ bindKey: (k, c) => km.bind(k, c) } as ClientApi);
  rebind?.(km);
  const out: string[] = [];
  const chord = createChord({
    windowMs,
    dispatch: (c: UiCommand) => {
      const a = c.type === 'action' ? c.action : null;
      out.push(a?.type === 'move' ? a.dir : (a?.type ?? c.type));
    },
  });
  const down = (code: string, repeat = false) =>
    chord.down(code, repeat, km.resolve({ code, key: code })!);
  return { chord, out, down };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('chord', () => {
  test('Up then Left within the window is one nw', () => {
    const { out, down } = setup();
    down('ArrowUp');
    vi.advanceTimersByTime(40);
    down('ArrowLeft');
    vi.advanceTimersByTime(500);
    expect(out).toEqual(['nw']);
  });

  test('quick tap of Up, released, then Right 60ms later is ne', () => {
    const { chord, out, down } = setup();
    down('ArrowUp');
    vi.advanceTimersByTime(30);
    chord.up('ArrowUp');
    vi.advanceTimersByTime(30);
    down('ArrowRight');
    vi.advanceTimersByTime(500);
    expect(out).toEqual(['ne']);
  });

  test('Up alone dispatches only after the window', () => {
    const { out, down } = setup();
    down('ArrowUp');
    vi.advanceTimersByTime(99);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(['n']);
  });

  test('Up then Down flushes n first, then s after the window', () => {
    const { out, down } = setup();
    down('ArrowUp');
    vi.advanceTimersByTime(20);
    down('ArrowDown');
    expect(out).toEqual(['n']);
    vi.advanceTimersByTime(100);
    expect(out).toEqual(['n', 's']);
  });

  test('held Left with repeating Up gives diagonals', () => {
    const { out, down } = setup();
    down('ArrowLeft');
    vi.advanceTimersByTime(500);
    out.length = 0;
    down('ArrowUp');
    down('ArrowUp', true);
    down('ArrowUp', true);
    expect(out).toEqual(['nw', 'nw', 'nw']);
  });

  test('a single held arrow repeats cardinals immediately', () => {
    const { out, down } = setup();
    down('ArrowUp');
    vi.advanceTimersByTime(100);
    down('ArrowUp', true);
    down('ArrowUp', true);
    expect(out).toEqual(['n', 'n', 'n']);
  });

  test('rebound arrow is dispatched immediately and never chorded', () => {
    const { out, down } = setup(100, (km) => km.bind('ArrowUp', { type: 'ui', id: 'menu' }));
    down('ArrowUp');
    expect(out).toEqual(['ui']);
    down('ArrowLeft');
    vi.advanceTimersByTime(100);
    expect(out).toEqual(['ui', 'w']);
  });

  test('windowMs 0 disables chording', () => {
    const { out, down } = setup(0);
    down('ArrowUp');
    expect(out).toEqual(['n']);
    down('ArrowLeft');
    expect(out).toEqual(['n', 'w']);
  });

  test('reset (blur) drops the pending move', () => {
    const { chord, out, down } = setup();
    down('ArrowUp');
    chord.reset();
    vi.advanceTimersByTime(500);
    expect(out).toEqual([]);
  });
});
