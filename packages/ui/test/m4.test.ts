import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AsyncCoreQuery, Glyph, PlayerAction, Prompt, Renderer, ViewUpdate } from '@nh/core';
import {
  createUi,
  defaultKeymap,
  uiMessagesEn,
  type GameClient,
  type Ui,
  ZOOM_STORAGE_KEY,
} from '../src/index';
import { clampCell, dist, pinchCell } from '../src/pinch';
import { statusLines } from '../src/status';
import { attachTap } from '../src/input';

class FakeRenderer implements Renderer {
  fit = false;
  cell = 10;
  calls: string[] = [];
  mount() {}
  apply() {}
  setGlyph(_id: string, _g: Glyph) {}
  cellAt() {
    return { x: 0, y: 0 };
  }
  resize() {}
  destroy() {}
  setFit(on: boolean) {
    this.fit = on;
    this.calls.push(`fit:${on}`);
  }
  setZoom(c: number) {
    this.fit = false;
    this.cell = c;
    this.calls.push(`zoom:${c}`);
  }
  resetZoom() {
    this.fit = false;
    this.cell = 10;
    this.calls.push('reset');
  }
  getCell() {
    return this.cell;
  }
}

const view = (status: ViewUpdate['status'] = {}): ViewUpdate => ({
  kind: 'delta',
  turn: 1,
  cells: [],
  entities: [],
  player: { id: 1, x: 5, y: 5 },
  status,
  inventory: [],
});
const key = (k: string, code = k, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...init }),
  );
const keyUp = (k: string, code = k) =>
  document.dispatchEvent(new KeyboardEvent('keyup', { key: k, code, bubbles: true }));
const ptr = (el: Element, type: string, id: number, x: number, y: number) =>
  el.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, pointerId: id }),
  );

let ui: Ui | undefined;
let renderer: FakeRenderer;
function mk(r: Renderer = new FakeRenderer()) {
  const root = document.createElement('div');
  document.body.append(root);
  const acts: PlayerAction[] = [];
  const offersFor = { current: [] as never[] };
  const game: GameClient = {
    act: (a) => void acts.push(a),
    query: {
      actionsFor: () => Promise.resolve(offersFor.current),
      describe: () =>
        Promise.resolve({
          terrain: null,
          remembered: false,
          visible: false,
          entities: [],
          objects: [],
        }),
    } as unknown as AsyncCoreQuery,
  };
  renderer = r as FakeRenderer;
  ui = createUi({ root, renderer: r, game, mods: [defaultKeymap], chordWindowMs: 50 });
  return { root, acts, ui };
}
afterEach(() => {
  ui?.destroy();
  ui = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
});

const ALL = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const dirPrompt = (dirs = ALL, id = 'd1'): Prompt => ({
  id,
  kind: 'direction',
  key: 'throw.direction',
  options: dirs.map((d) => ({ value: d, key: `dir.${d}` })),
});
const dirBtn = (root: Element, d: string) =>
  root.querySelector(`.nh-compass [data-dir="${d}"]`) as HTMLButtonElement;

describe('compass', () => {
  test('lays out a 3x3 pad with cancel in the middle', () => {
    const m = mk();
    m.ui.update(view(), [], dirPrompt());
    const cells = [...m.root.querySelectorAll('.nh-compass button')] as HTMLButtonElement[];
    expect(cells.map((b) => b.dataset['dir'] ?? 'x')).toEqual([
      'nw',
      'n',
      'ne',
      'w',
      'x',
      'e',
      'sw',
      's',
      'se',
    ]);
    expect(cells.map((b) => b.textContent)).toEqual(['↖', '↑', '↗', '←', '✕', '→', '↙', '↓', '↘']);
  });

  test('buttons answer with the option value; cancel answers null', () => {
    const m = mk();
    m.ui.update(view(), [], dirPrompt());
    dirBtn(m.root, 'sw').click();
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'd1', value: 'sw' }]);
    m.ui.update(view(), [], null);
    m.ui.update(view(), [], dirPrompt(ALL, 'd2'));
    (m.root.querySelector('.nh-compass .nh-cancel') as HTMLElement).click();
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 'd2', value: null });
  });

  test('directions the prompt does not offer are disabled', () => {
    const m = mk();
    m.ui.update(view(), [], dirPrompt(['n', 'e']));
    expect(dirBtn(m.root, 'n').disabled).toBe(false);
    expect(dirBtn(m.root, 'se').disabled).toBe(true);
    dirBtn(m.root, 'se').click();
    key('b'); // sw is not offered either
    expect(m.acts).toEqual([]);
  });

  test('vi keys pick, Escape cancels', () => {
    const m = mk();
    m.ui.update(view(), [], dirPrompt());
    key('y');
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'd1', value: 'nw' }]);
    m.ui.update(view(), [], null);
    m.ui.update(view(), [], dirPrompt(ALL, 'd2'));
    key('Escape');
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 'd2', value: null });
  });

  test('arrow keys pick, and two arrows chord into a diagonal', () => {
    vi.useFakeTimers();
    const m = mk();
    m.ui.update(view(), [], dirPrompt());
    key('ArrowLeft');
    vi.advanceTimersByTime(60);
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'd1', value: 'w' }]);
    keyUp('ArrowLeft');
    m.ui.update(view(), [], null);
    m.ui.update(view(), [], dirPrompt(ALL, 'd2'));
    key('ArrowUp');
    key('ArrowRight');
    vi.advanceTimersByTime(60);
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 'd2', value: 'ne' });
    expect(m.acts).toHaveLength(2);
  });
});

describe('text prompt', () => {
  const tp: Prompt = { id: 't1', kind: 'text', key: 'name.ask', maxLength: 5 };
  const input = (root: Element) => root.querySelector('.nh-text-input') as HTMLInputElement;

  test('Enter submits the trimmed text capped at maxLength', () => {
    const m = mk();
    m.ui.update(view(), [], tp);
    expect(input(m.root).maxLength).toBe(5);
    input(m.root).value = '  abcdefgh ';
    input(m.root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(m.acts).toEqual([{ type: 'answer', promptId: 't1', value: 'abcde' }]);
  });

  test('OK submits, Escape and Cancel answer null', () => {
    const m = mk();
    m.ui.update(view(), [], tp);
    input(m.root).value = 'ok';
    (m.root.querySelector('.nh-confirm') as HTMLElement).click();
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 't1', value: 'ok' });
    m.ui.update(view(), [], null);
    m.ui.update(view(), [], { ...tp, id: 't2' });
    input(m.root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 't2', value: null });
    m.ui.update(view(), [], null);
    m.ui.update(view(), [], { ...tp, id: 't3' });
    (m.root.querySelector('.nh-sheet .nh-cancel') as HTMLElement).click();
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 't3', value: null });
  });

  test('game keys do not fire while typing', () => {
    const m = mk();
    m.ui.update(view(), [], tp);
    input(m.root).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }),
    );
    key('k'); // not from the input: the sheet swallows it, no move either
    expect(m.acts).toEqual([]);
  });
});

describe('count menus', () => {
  const mp: Prompt = {
    id: 'm1',
    kind: 'menu',
    key: 'pickup',
    multi: true,
    options: [
      { value: 11, key: 'a', max: 5 },
      { value: 12, key: 'b' },
      { value: 13, key: 'c', max: 3 },
    ],
  };
  const stepBtn = (root: Element, row: number, label: 'Fewer' | 'More') =>
    root
      .querySelectorAll('.nh-check-row')
      [row]!.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  const confirm = (root: Element) => (root.querySelector('.nh-confirm') as HTMLElement).click();

  test('counts default to max: whole stack answers the plain value', () => {
    const m = mk();
    m.ui.update(view(), [], mp);
    expect(m.root.querySelectorAll('.nh-step')).toHaveLength(4);
    (m.root.querySelectorAll('.nh-check')[0] as HTMLElement).click();
    expect(m.root.querySelectorAll('.nh-count')[0]!.textContent).toBe('5');
    confirm(m.root);
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'm1', value: [11] }]);
  });

  test('stepper lowers the count and selects the row', () => {
    const m = mk();
    m.ui.update(view(), [], mp);
    stepBtn(m.root, 0, 'Fewer').click();
    stepBtn(m.root, 0, 'Fewer').click();
    expect(m.root.querySelectorAll('.nh-count')[0]!.textContent).toBe('3');
    stepBtn(m.root, 0, 'More').click();
    (m.root.querySelectorAll('.nh-check')[1] as HTMLElement).click();
    confirm(m.root);
    expect(m.acts).toEqual([
      { type: 'answer', promptId: 'm1', value: [{ value: 11, count: 4 }, 12] },
    ]);
  });

  test('count never goes below 1', () => {
    const m = mk();
    m.ui.update(view(), [], mp);
    for (let i = 0; i < 6; i++) stepBtn(m.root, 1, 'Fewer').click();
    confirm(m.root);
    expect(m.acts[0]).toEqual({ type: 'answer', promptId: 'm1', value: [{ value: 13, count: 1 }] });
  });

  test('digits before a letter set the count ("3a")', () => {
    const m = mk();
    m.ui.update(view(), [], mp);
    key('3');
    key('a');
    key('9'); // above max: capped
    key('c');
    key('b'); // plain toggle
    key('Enter');
    expect(m.acts).toEqual([
      {
        type: 'answer',
        promptId: 'm1',
        value: [{ value: 11, count: 3 }, 12, 13],
      },
    ]);
  });

  test('digits are dropped by other keys and ignored on rows without a max', () => {
    const m = mk();
    m.ui.update(view(), [], mp);
    key('2');
    key('ArrowDown'); // clears the typed number
    key('a');
    key('2');
    key('b'); // no max: just a toggle
    key('Enter');
    expect(m.acts[0]).toEqual({ type: 'answer', promptId: 'm1', value: [11, 12] });
  });
});

describe('status words', () => {
  test('stun shows as Stun; unknown fields need a catalog key', () => {
    const [, l2] = statusLines({ hp: 5, hpmax: 5, stun: 1, zorp: 1, conf: 0 });
    const texts = l2.map((f) => f.text);
    expect(texts).toContain('Stun');
    expect(texts).not.toContain('zorp');
    expect(texts).not.toContain('Conf');
    const t = (k: string) => (k === 'ui.status.zorp' ? 'Zorped' : (uiMessagesEn[k] ?? k));
    const has = (k: string) => k === 'ui.status.zorp' || k in uiMessagesEn;
    expect(statusLines({ zorp: 1, hp: 3, hpmax: 5 }, t, has)[1].map((f) => f.text)).toEqual([
      'HP:3(5)',
      'Zorped',
    ]);
  });
});

describe('zoom', () => {
  const zoomBtn = (root: Element) => root.querySelector('.nh-zoom-btn') as HTMLButtonElement;

  test('the bar button toggles fit-to-width and remembers it', () => {
    const m = mk();
    zoomBtn(m.root).click();
    expect(renderer.calls).toEqual(['fit:true']);
    expect(zoomBtn(m.root).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(ZOOM_STORAGE_KEY)).toBe('fit');
    zoomBtn(m.root).click();
    expect(renderer.calls.at(-1)).toBe('reset');
    expect(localStorage.getItem(ZOOM_STORAGE_KEY)).toBe('');
  });

  test('a saved zoom is applied at start', () => {
    localStorage.setItem(ZOOM_STORAGE_KEY, 'fit');
    mk();
    expect(renderer.calls).toEqual(['fit:true']);
    ui?.destroy();
    localStorage.setItem(ZOOM_STORAGE_KEY, '14');
    mk();
    expect(renderer.calls).toEqual(['zoom:14']);
  });

  test('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const m = mk();
    expect(() => zoomBtn(m.root).click()).not.toThrow();
    expect(renderer.fit).toBe(true);
    vi.restoreAllMocks();
  });

  test('the button is hidden for a renderer without zoom', () => {
    const r: Renderer = {
      mount() {},
      apply() {},
      setGlyph() {},
      cellAt: () => null,
      resize() {},
      destroy() {},
    };
    const m = mk(r);
    expect(zoomBtn(m.root).hidden).toBe(true);
  });

  test('a two-finger pinch scales the cell, persists, and is not a tap', () => {
    const m = mk();
    const map = m.root.querySelector('.nh-map')!;
    const taps: number[] = [];
    // the real tap handler runs on the map: a tap would query actionsFor / act
    const detach = attachTap(map as HTMLElement, () => taps.push(1));
    ptr(map, 'pointerdown', 1, 100, 100);
    ptr(map, 'pointerdown', 2, 200, 100);
    ptr(map, 'pointermove', 2, 300, 100); // distance 100 -> 200: double
    expect(renderer.calls.at(-1)).toBe('zoom:20');
    ptr(map, 'pointerup', 2, 300, 100);
    ptr(map, 'pointerup', 1, 100, 100);
    expect(taps).toEqual([]);
    expect(localStorage.getItem(ZOOM_STORAGE_KEY)).toBe('20');
    // a single tap afterwards still works
    ptr(map, 'pointerdown', 3, 5, 5);
    ptr(map, 'pointerup', 3, 5, 5);
    expect(taps).toEqual([1]);
    detach();
  });

  test('pinch math', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchCell(10, 100, 200)).toBe(20);
    expect(pinchCell(10, 100, 50)).toBe(5);
    expect(pinchCell(10, 100, 1)).toBe(4);
    expect(pinchCell(10, 100, 10000)).toBe(48);
    expect(pinchCell(10, 0, 50)).toBe(10);
    expect(pinchCell(10, 100, 133)).toBe(13.5);
    expect(clampCell(1)).toBe(4);
  });
});

describe('ctrl keys', () => {
  test('Ctrl+<key> only acts when bound', () => {
    const m = mk();
    m.ui.api.bindKey('Ctrl+d', { type: 'action', action: { type: 'wait' } });
    key('d', 'KeyD', { ctrlKey: true });
    key('k', 'KeyK', { ctrlKey: true });
    expect(m.acts).toEqual([{ type: 'wait' }]);
  });
});
