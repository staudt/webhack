import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  ActionOffer,
  AsyncCoreQuery,
  ClientMod,
  Description,
  DefId,
  GameEvent,
  Glyph,
  PlayerAction,
  Pos,
  Prompt,
  Renderer,
  ViewUpdate,
} from '@nh/core';
import { createUi, defaultKeymap, uiMessagesEn, type GameClient, type Ui } from '../src/index';

class FakeRenderer implements Renderer {
  mounted: object | null = null;
  applied: ViewUpdate[] = [];
  glyphs: [string, Glyph][] = [];
  cell: Pos | null = { x: 0, y: 0 };
  destroyed = false;
  mount(el: object) {
    this.mounted = el;
  }
  apply(v: ViewUpdate) {
    this.applied.push(v);
  }
  setGlyph(id: DefId, g: Glyph) {
    this.glyphs.push([id, g]);
  }
  cellAt() {
    return this.cell;
  }
  resize() {}
  destroy() {
    this.destroyed = true;
  }
}

function fakeGame() {
  const acts: PlayerAction[] = [];
  const state = {
    offers: [] as ActionOffer[],
    desc: { terrain: null, remembered: false, visible: false, entities: [] } as Description,
    describeCalls: [] as Pos[],
  };
  const query = {
    describe: (p: Pos) => {
      state.describeCalls.push(p);
      return Promise.resolve(state.desc);
    },
    actionsFor: () => Promise.resolve(state.offers),
    pathTo: () => Promise.resolve(null),
  } as AsyncCoreQuery;
  const game: GameClient = { act: (a) => void acts.push(a), query };
  return { game, acts, state };
}

const view = (x = 5, y = 5): ViewUpdate => ({
  kind: 'delta',
  turn: 1,
  cells: [],
  entities: [],
  player: { id: 1, x, y },
  status: {},
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (k: string, code = k, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...init }),
  );
const keyUp = (k: string, code = k) =>
  document.dispatchEvent(new KeyboardEvent('keyup', { key: k, code, bubbles: true }));
function tap(el: Element) {
  const o = { clientX: 1, clientY: 1, bubbles: true };
  el.dispatchEvent(
    Object.assign(new Event('pointerdown', o), { clientX: 1, clientY: 1, pointerId: 1 }),
  );
  el.dispatchEvent(
    Object.assign(new Event('pointerup', o), { clientX: 1, clientY: 1, pointerId: 1 }),
  );
}
const mk = (extra: { mods?: ClientMod[] } = {}) => {
  const root = document.createElement('div');
  document.body.append(root);
  const renderer = new FakeRenderer();
  const g = fakeGame();
  const ui = createUi({ root, renderer, game: g.game, mods: extra.mods ?? [defaultKeymap] });
  return { root, renderer, ui, ...g };
};
const btns = (root: Element) =>
  [...root.querySelectorAll('.nh-sheet button')] as HTMLButtonElement[];
const logText = (root: Element) =>
  [...root.querySelectorAll('.nh-log-recent .nh-line')].map((e) => e.textContent);
const offer = (dir: 'n' | 'e', label = 'Go'): ActionOffer => ({
  action: { type: 'move', dir },
  labelKey: label,
  source: 't',
});

let ui: Ui | undefined;
afterEach(() => {
  ui?.destroy();
  ui = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('host', () => {
  test('mounts renderer into map and has base layout', () => {
    const m = mk();
    ui = m.ui;
    expect(m.renderer.mounted).toBe(m.root.querySelector('.nh-map'));
    expect(m.root.querySelector('.nh-bar')?.textContent).toContain('☰');
    expect(document.getElementById('nh-ui-style')).not.toBeNull();
  });

  test('keydown k acts move n; modifiers ignored; unbound ignored', () => {
    const m = mk();
    ui = m.ui;
    key('k', 'KeyK');
    key('k', 'KeyK', { ctrlKey: true });
    key('q', 'KeyQ');
    expect(m.acts).toEqual([{ type: 'move', dir: 'n' }]);
  });

  test('arrow chord via DOM events makes one diagonal; numpad and vi stay instant', () => {
    vi.useFakeTimers();
    try {
      const m = mk();
      ui = m.ui;
      key('ArrowUp');
      key('ArrowLeft');
      keyUp('ArrowUp');
      keyUp('ArrowLeft');
      vi.advanceTimersByTime(500);
      expect(m.acts).toEqual([{ type: 'move', dir: 'nw' }]);
      m.acts.length = 0;
      key('ArrowUp', 'Numpad8');
      key('k', 'KeyK');
      expect(m.acts).toEqual([
        { type: 'move', dir: 'n' },
        { type: 'move', dir: 'n' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('tap adjacent cell with one offer acts', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.update(view(), [], null);
    m.renderer.cell = { x: 6, y: 5 };
    m.state.offers = [offer('e')];
    tap(m.root.querySelector('.nh-map')!);
    await flush();
    expect(m.acts).toEqual([{ type: 'move', dir: 'e' }]);
  });

  test('tap self shows menu; clicking offer acts; Cancel closes', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { go: 'Go north' });
    m.ui.update(view(), [], null);
    m.renderer.cell = { x: 5, y: 5 };
    m.state.offers = [offer('n', 'go')];
    tap(m.root.querySelector('.nh-map')!);
    await flush();
    const b = btns(m.root);
    expect(b.map((x) => x.textContent)).toEqual(['Go north', 'Cancel']);
    b[0]!.click();
    expect(m.acts).toEqual([{ type: 'move', dir: 'n' }]);
    expect(btns(m.root)).toHaveLength(0);
  });

  test('modal swallows keys', async () => {
    const m = mk();
    ui = m.ui;
    m.state.offers = [offer('n')];
    (m.root.querySelector('.nh-actions-btn') as HTMLElement).click();
    await flush();
    key('k', 'KeyK');
    expect(m.acts).toEqual([]);
    key('Escape');
    expect(btns(m.root)).toHaveLength(0);
  });

  test('Look mode describes and logs; remembered suffix', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { 'nh:floor': 'floor', 'nh:newt': 'newt' });
    m.ui.update(view(), [], null);
    m.renderer.cell = { x: 6, y: 5 };
    m.state.offers = [offer('e')];
    m.state.desc = { terrain: 'nh:floor', remembered: true, visible: false, entities: [] };
    (m.root.querySelector('.nh-look-btn') as HTMLElement).click();
    tap(m.root.querySelector('.nh-map')!);
    await flush();
    expect(m.acts).toEqual([]);
    expect(logText(m.root)).toEqual(['You see: floor (remembered).']);
    m.state.desc = {
      terrain: 'nh:floor',
      remembered: true,
      visible: true,
      entities: [{ id: 2, def: 'nh:newt' }],
    };
    m.renderer.cell = { x: 9, y: 9 };
    tap(m.root.querySelector('.nh-map')!);
    await flush();
    expect(logText(m.root).at(-1)).toBe('You see: newt, floor.');
  });

  test('unexplored description', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.update(view(), [], null);
    m.renderer.cell = { x: 20, y: 20 };
    tap(m.root.querySelector('.nh-map')!);
    await flush();
    expect(logText(m.root)).toEqual([uiMessagesEn['describe.unexplored']]);
  });

  test('msg events are translated, onEvent runs after, notify logs', () => {
    const seen: string[] = [];
    const mod: ClientMod = {
      id: 'm',
      version: '1',
      register(api) {
        api.addMessages('en', { hit: 'You hit the {what}.', 'nh:newt': 'newt' });
        api.onEvent((e) => seen.push(e.type + ':' + logText(document.body).length));
        api.setGlyph('nh:floor', { ch: '.', fg: '#fff' });
      },
    };
    const m = mk({ mods: [mod] });
    ui = m.ui;
    const evs: GameEvent[] = [
      { type: 'msg', key: 'hit', params: { what: '@nh:newt' } },
      { type: 'searched' },
    ];
    m.ui.update(view(), evs, null);
    m.ui.notify('ui.saved');
    expect(logText(m.root)).toEqual(['You hit the newt.', 'Game saved.']);
    expect(seen).toEqual(['msg:1', 'searched:1']);
    expect(m.renderer.glyphs).toEqual([['nh:floor', { ch: '.', fg: '#fff' }]]);
    expect(m.renderer.applied).toHaveLength(1);
  });

  test('log shows last 3, history keeps up to 200', () => {
    const m = mk();
    ui = m.ui;
    for (let i = 0; i < 205; i++) m.ui.notify('ui.saved', { i });
    expect(logText(m.root)).toHaveLength(3);
    expect(m.root.querySelectorAll('.nh-log-history .nh-line')).toHaveLength(200);
    const log = m.root.querySelector('.nh-log') as HTMLElement;
    const hist = m.root.querySelector('.nh-log-history') as HTMLElement;
    expect(hist.hidden).toBe(true);
    log.click();
    expect(hist.hidden).toBe(false);
  });

  test('menu items from addMenuItem appear in order and run', () => {
    const run1 = vi.fn(),
      run2 = vi.fn();
    const mod: ClientMod = {
      id: 'm',
      version: '1',
      register(api) {
        api.addMessages('en', { a: 'Alpha', b: 'Beta' });
        api.addMenuItem({ id: 'a', labelKey: 'a', run: run1 });
        api.addMenuItem({ id: 'b', labelKey: 'b', run: run2 });
      },
    };
    const m = mk({ mods: [mod] });
    ui = m.ui;
    (m.root.querySelector('.nh-menu-btn') as HTMLElement).click();
    expect(btns(m.root).map((b) => b.textContent)).toEqual(['Alpha', 'Beta', 'Cancel']);
    btns(m.root)[1]!.click();
    expect(run2).toHaveBeenCalled();
    expect(run1).not.toHaveBeenCalled();
  });

  test('yn prompt answers via buttons', () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { q: 'Really?' });
    const prompt: Prompt = { id: 'p1', kind: 'yn', key: 'q' };
    m.ui.update(view(), [], prompt);
    m.ui.update(view(), [], prompt);
    expect(btns(m.root).map((b) => b.textContent)).toEqual(['Yes', 'No']);
    btns(m.root)[0]!.click();
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'p1', value: true }]);
    m.ui.update(view(), [], null);
    expect(btns(m.root)).toHaveLength(0);
  });

  test('menu prompt lists options', () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { q: 'Pick', o1: 'One' });
    m.ui.update(view(), [], {
      id: 'p2',
      kind: 'menu',
      key: 'q',
      options: [{ value: 7, key: 'o1' }],
    });
    btns(m.root)[0]!.click();
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'p2', value: 7 }]);
  });

  test('destroy removes DOM, style and listeners', () => {
    const m = mk();
    m.ui.destroy();
    expect(m.root.childNodes).toHaveLength(0);
    expect(document.getElementById('nh-ui-style')).toBeNull();
    expect(m.renderer.destroyed).toBe(true);
    key('k', 'KeyK');
    expect(m.acts).toEqual([]);
  });
});
