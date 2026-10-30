import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  AsyncCoreQuery,
  GameEvent,
  Glyph,
  PlayerAction,
  Pos,
  Renderer,
  ViewUpdate,
} from '@nh/core';
import {
  createUi,
  defaultKeymap,
  DEFAULT_STEP_DELAY_MS,
  type GameClient,
  type Ui,
} from '../src/index';

class FlashRenderer implements Renderer {
  log: string[] = [];
  mount() {}
  apply() {
    this.log.push('apply');
  }
  setGlyph(_id: string, _g: Glyph) {}
  cellAt() {
    return { x: 0, y: 0 };
  }
  resize() {}
  destroy() {}
  flash(pos: Pos, g: string | null) {
    this.log.push(g === null ? 'off' : `${g}@${pos.x},${pos.y}`);
  }
}

const view = (): ViewUpdate => ({
  kind: 'delta',
  turn: 1,
  cells: [],
  entities: [],
  player: { id: 1, x: 5, y: 5 },
  status: {},
  inventory: [],
});
const proj = (g: `${string}:${string}`, ...xs: number[]): GameEvent => ({
  type: 'projectile',
  g,
  path: xs.map((x) => ({ x, y: 5 })),
});
const key = (k: string, code = k) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true }));

let ui: Ui | undefined;
function mk(r: Renderer = new FlashRenderer()) {
  vi.useFakeTimers();
  const root = document.createElement('div');
  document.body.append(root);
  const acts: PlayerAction[] = [];
  const game: GameClient = {
    act: (a) => void acts.push(a),
    query: {} as unknown as AsyncCoreQuery,
  };
  ui = createUi({ root, renderer: r, game, mods: [defaultKeymap], chordWindowMs: 0 });
  return { root, acts, ui, r: r as FlashRenderer };
}
afterEach(() => {
  ui?.destroy();
  ui = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});
const lines = (root: Element) =>
  [...root.querySelectorAll('.nh-log-recent .nh-line')].map((e) => e.textContent);
const D = DEFAULT_STEP_DELAY_MS;
const hit: GameEvent = { type: 'msg', key: 'throw.hit' };

describe('projectile flight', () => {
  test('frames play in order at the step delay, then the view and the log', () => {
    const m = mk();
    m.ui.update(view(), [proj('nh:dagger', 6, 7, 8), hit], null);
    expect(m.r.log).toEqual(['nh:dagger@6,5']);
    expect(lines(m.root)).toEqual([]);
    vi.advanceTimersByTime(D);
    expect(m.r.log).toEqual(['nh:dagger@6,5', 'nh:dagger@7,5']);
    vi.advanceTimersByTime(D);
    expect(m.r.log.at(-1)).toBe('nh:dagger@8,5');
    expect(m.r.log).not.toContain('apply');
    vi.advanceTimersByTime(D);
    expect(m.r.log.slice(-2)).toEqual(['off', 'apply']);
    expect(lines(m.root)).toHaveLength(1);
  });

  test('input skips the rest, applies the update, and is then handled', () => {
    const m = mk();
    m.ui.update(view(), [proj('nh:dagger', 6, 7, 8), hit], null);
    key('l');
    expect(m.r.log.slice(-2)).toEqual(['off', 'apply']);
    expect(lines(m.root)).toHaveLength(1);
    expect(m.acts).toEqual([{ type: 'move', dir: 'e' }]);
    vi.advanceTimersByTime(10 * D);
    expect(m.r.log.filter((l) => l === 'apply')).toHaveLength(1);
  });

  test('several projectiles play one after another', () => {
    const m = mk();
    m.ui.update(view(), [proj('nh:dagger', 6, 7), proj('nh:spear', 6), hit], null);
    vi.advanceTimersByTime(3 * D);
    expect(m.r.log).toEqual(['nh:dagger@6,5', 'nh:dagger@7,5', 'nh:spear@6,5', 'off', 'apply']);
  });

  test('a continue waits for the flight; input during it cancels the occupation', () => {
    const m = mk();
    m.ui.update(view(), [proj('nh:dagger', 6, 7)], null, true);
    vi.advanceTimersByTime(D);
    expect(m.acts).toEqual([]);
    vi.advanceTimersByTime(D); // flight over, update applied, continue scheduled
    expect(m.acts).toEqual([]);
    vi.advanceTimersByTime(D);
    expect(m.acts).toEqual([{ type: 'continue' }]);

    const n = mk();
    n.ui.update(view(), [proj('nh:dagger', 6)], null, true);
    key('l'); // skips the flight and cancels the continuing action: swallowed
    vi.advanceTimersByTime(10 * D);
    expect(n.acts).toEqual([]);
  });

  test('no projectile events, no animation', () => {
    const m = mk();
    m.ui.update(view(), [hit], null);
    expect(m.r.log).toEqual(['apply']);
    expect(lines(m.root)).toHaveLength(1);
  });

  test('a renderer without flash applies at once', () => {
    const r = new FlashRenderer();
    (r as unknown as { flash?: unknown }).flash = undefined;
    const m = mk(r);
    m.ui.update(view(), [proj('nh:dagger', 6), hit], null);
    expect(m.r.log).toEqual(['apply']);
  });
});
