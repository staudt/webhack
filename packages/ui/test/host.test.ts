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
  ViewItem,
  ViewUpdate,
} from '@nh/core';
import {
  createUi,
  defaultKeymap,
  formatStr,
  hpLevel,
  uiMessagesEn,
  type GameClient,
  type Ui,
} from '../src/index';

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
    desc: {
      terrain: null,
      remembered: false,
      visible: false,
      entities: [],
      objects: [],
    } as Description,
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
  inventory: [],
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
    m.state.desc = {
      terrain: 'nh:floor',
      remembered: true,
      visible: false,
      entities: [],
      objects: [],
    };
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
      objects: [],
    };
    m.renderer.cell = { x: 9, y: 9 };
    m.state.offers = [];
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

describe('status bar, tombstone, tap to act', () => {
  const st = (status: Record<string, string | number>): ViewUpdate => ({ ...view(), status });
  const lines = (root: Element) =>
    [...root.querySelectorAll('.nh-status-line')].map((e) => e.textContent);

  test('Str formatting', () => {
    const cases: [number, string][] = [
      [3, '3'],
      [18, '18'],
      [19, '18/01'],
      [68, '18/50'],
      [117, '18/99'],
      [118, '18/**'],
      [119, '19'],
      [125, '25'],
    ];
    for (const [n, s] of cases) expect(formatStr(n)).toBe(s);
  });

  test('status bar renders snapshot and delta', () => {
    const m = mk();
    ui = m.ui;
    m.ui.update(
      st({
        str: 68,
        dex: 14,
        con: 18,
        int: 7,
        wis: 9,
        cha: 7,
        dlvl: 1,
        hp: 16,
        hpmax: 16,
        ac: 6,
        xl: 1,
        xp: 0,
        turn: 123,
      }),
      [],
      null,
    );
    expect(lines(m.root)).toEqual([
      'St:18/50Dx:14Co:18In:7Wi:9Ch:7',
      'Dlvl:1HP:16(16)AC:6Xp:1/0T:123',
    ]);
    m.ui.update(st({ dlvl: 2, turn: 124 }), [], null);
    expect(lines(m.root)).toEqual(['Dlvl:2T:124']);
  });

  test('HP colors', () => {
    expect(hpLevel(16, 16)).toBe('ok');
    expect(hpLevel(10, 30)).toBe('ok');
    expect(hpLevel(9, 30)).toBe('warn');
    expect(hpLevel(5, 100)).toBe('crit');
    expect(hpLevel(2, 20)).toBe('crit');
    const m = mk();
    ui = m.ui;
    m.ui.update(st({ hp: 3, hpmax: 30 }), [], null);
    expect(m.root.querySelector('.nh-hp-crit')?.textContent).toBe('HP:3(30)');
  });

  test.each([
    ['nh:jackal', 'killed by a jackal'],
    ['@nh:iguana', 'killed by an iguana'],
  ])('tombstone for %s', (killer, text) => {
    const onNewGame = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);
    const g = fakeGame();
    ui = createUi({
      root,
      renderer: new FakeRenderer(),
      game: g.game,
      mods: [defaultKeymap],
      onNewGame,
    });
    ui.api.addMessages('en', { 'nh:jackal': 'jackal', 'nh:iguana': 'iguana' });
    ui.update(
      st({ dead: 'died', killer, endTurn: 77, endDepth: 3, endLevel: 2, turn: 77, dlvl: 3 }),
      [],
      null,
    );
    const body = root.querySelector('.nh-sheet-body')?.textContent ?? '';
    expect(body).toContain(text);
    expect(body).toContain('on turn 77');
    expect(root.querySelector('.nh-cancel')).toBeNull();
    key('Escape');
    expect(root.querySelector('.nh-sheet')).not.toBeNull();
    ui.update(st({ dead: 'died', killer, turn: 77 }), [], null);
    expect(root.querySelectorAll('.nh-sheet').length).toBe(1);
    btns(root)[0]?.click();
    expect(onNewGame).toHaveBeenCalledOnce();
  });

  test('escaped summary; Enter starts new game', () => {
    const onNewGame = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);
    ui = createUi({
      root,
      renderer: new FakeRenderer(),
      game: fakeGame().game,
      mods: [],
      onNewGame,
    });
    ui.update(st({ dead: 'escaped', turn: 9 }), [], null);
    expect(root.querySelector('.nh-sheet-title')?.textContent).toBe('You escaped the dungeon.');
    key('Enter');
    expect(onNewGame).toHaveBeenCalledOnce();
  });

  test('tap on a distant cell: one offer acts, none describes', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.update(view(5, 5), [], null);
    m.renderer.cell = { x: 20, y: 5 };
    m.state.offers = [offer('e', 'Travel')];
    tap(m.root.querySelector('.nh-map') as Element);
    await flush();
    expect(m.acts).toEqual([{ type: 'move', dir: 'e' }]);
    expect(m.state.describeCalls).toEqual([]);
    m.state.offers = [];
    tap(m.root.querySelector('.nh-map') as Element);
    await flush();
    expect(m.state.describeCalls).toEqual([{ x: 20, y: 5 }]);
  });
});

const item = (
  id: number,
  letter: string,
  cls: ViewItem['cls'],
  name: string,
  eq = false,
): ViewItem => ({
  id,
  letter,
  g: `nh:${name}`,
  cls,
  name: { key: `obj.${name}` },
  equipped: eq ? (cls === 'weapon' ? 'weapon' : 'body') : null,
});
const invView = (inventory: ViewItem[]): ViewUpdate =>
  ({
    kind: 'full',
    levelId: 'l',
    width: 1,
    height: 1,
    legend: { 'nh:dagger': { ch: ')', fg: '#0ff' } },
    cells: [],
    entities: [],
    player: { id: 1, x: 5, y: 5 },
    turn: 1,
    status: {},
    inventory,
  }) as unknown as ViewUpdate;
const msgs = { 'obj.dagger': 'a dagger', 'obj.ration': 'a food ration', 'obj.mail': 'a mail' };

describe('inventory, pickers, multi-select, list', () => {
  test('inventory sheet: grouped, suffixes, live update, tap -> actionsFor item -> act', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', msgs);
    const asked: unknown[] = [];
    m.game.query.actionsFor = (t) => {
      asked.push(t);
      return Promise.resolve([
        {
          action: { type: 'mod', action: 'nh:drop', params: { item: 1 } } as PlayerAction,
          labelKey: 'Drop',
          source: 't',
        },
      ]);
    };
    m.ui.update(
      invView([item(2, 'b', 'food', 'ration'), item(1, 'a', 'weapon', 'dagger', true)]),
      [],
      null,
    );
    (m.root.querySelector('.nh-inventory-btn') as HTMLElement).click();
    expect(m.root.querySelector('.nh-sheet-title')?.textContent).toBe('Inventory');
    expect([...m.root.querySelectorAll('.nh-sheet-heading')].map((e) => e.textContent)).toEqual([
      'Weapons',
      'Comestibles',
    ]);
    expect(btns(m.root).map((b) => b.textContent)).toEqual([
      ') a - a dagger (weapon in hand)',
      'b - a food ration',
      'Close',
    ]);
    m.ui.update(
      { ...(invView([item(1, 'a', 'weapon', 'dagger')]) as object), kind: 'delta' } as ViewUpdate,
      [],
      null,
    );
    expect(btns(m.root).map((b) => b.textContent)).toEqual([') a - a dagger', 'Close']);
    btns(m.root)[0]!.click();
    await flush();
    expect(asked).toEqual([{ kind: 'item', id: 1 }]);
    btns(m.root)[0]!.click();
    expect(m.acts).toEqual([{ type: 'mod', action: 'nh:drop', params: { item: 1 } }]);
    expect(btns(m.root)).toHaveLength(0);
  });

  test('empty inventory and escape; keyboard binding via ui command', () => {
    const mod: ClientMod = {
      id: 'k',
      version: '1',
      register: (api) => api.bindKey('i', { type: 'ui', id: 'inventory' }),
    };
    const m = mk({ mods: [defaultKeymap, mod] });
    ui = m.ui;
    m.ui.update(invView([]), [], null);
    key('i');
    expect(m.root.querySelector('.nh-sheet-text')?.textContent).toBe('Not carrying anything.');
    key('Escape');
    expect(btns(m.root)).toHaveLength(0);
  });

  test('pick:<action> filters items by offer; none logs a message; self:<action>', async () => {
    const mod: ClientMod = {
      id: 'k',
      version: '1',
      register: (api) => {
        api.bindKey('d', { type: 'ui', id: 'pick:nh:drop' });
        api.bindKey(',', { type: 'ui', id: 'self:nh:pickup' });
      },
    };
    const m = mk({ mods: [defaultKeymap, mod] });
    ui = m.ui;
    m.ui.api.addMessages('en', msgs);
    const drop = (id: number): ActionOffer => ({
      action: { type: 'mod', action: 'nh:drop', params: { item: id } } as PlayerAction,
      labelKey: 'D',
      source: 't',
    });
    m.game.query.actionsFor = (t) =>
      Promise.resolve(
        t.kind === 'self'
          ? [
              {
                action: { type: 'mod', action: 'nh:pickup' } as PlayerAction,
                labelKey: 'P',
                source: 't',
              },
            ]
          : 'id' in t && t.id === 2
            ? [drop(2)]
            : [
                {
                  action: { type: 'mod', action: 'nh:wield' } as PlayerAction,
                  labelKey: 'W',
                  source: 't',
                },
              ],
      );
    m.ui.update(
      invView([item(1, 'a', 'weapon', 'dagger'), item(2, 'b', 'food', 'ration')]),
      [],
      null,
    );
    key('d');
    await flush();
    expect(m.root.querySelector('.nh-sheet-title')?.textContent).toBe('What do you want to drop?');
    expect(btns(m.root).map((b) => b.textContent)).toEqual(['b - a food ration', 'Cancel']);
    btns(m.root)[0]!.click();
    expect(m.acts).toEqual([{ type: 'mod', action: 'nh:drop', params: { item: 2 } }]);
    m.ui.update(invView([item(1, 'a', 'weapon', 'dagger')]), [], null);
    key('d');
    await flush();
    expect(btns(m.root)).toHaveLength(0);
    expect(logText(m.root).at(-1)).toBe("You don't have anything to drop.");
    key(',');
    await flush();
    expect(m.acts.at(-1)).toEqual({ type: 'mod', action: 'nh:pickup' });
  });

  const multi: Prompt = {
    id: 'p1',
    kind: 'menu',
    key: 'prompt.pickup',
    multi: true,
    options: [
      { value: 11, key: 'obj.dagger', glyph: 'nh:dagger' },
      { value: 12, key: 'obj.ration' },
      { value: 13, key: 'obj.mail' },
    ],
  };
  const rows = (root: Element) => [...root.querySelectorAll('.nh-check')] as HTMLElement[];

  test('multi prompt: toggles, confirm answers array; cancel answers []', () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { ...msgs, 'prompt.pickup': 'Pick up what?' });
    m.ui.update(invView([]), [], multi);
    expect(rows(m.root)).toHaveLength(3);
    expect(rows(m.root)[0]!.querySelector('.nh-glyph')?.textContent).toBe(')');
    rows(m.root)[0]!.click();
    rows(m.root)[2]!.click();
    expect(rows(m.root).map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'true',
    ]);
    (m.root.querySelector('.nh-confirm') as HTMLElement).click();
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'p1', value: [11, 13] }]);
    m.ui.update(invView([]), [], null);
    m.ui.update(invView([]), [], { ...multi, id: 'p2' });
    (m.root.querySelector('.nh-sheet .nh-cancel') as HTMLElement).click();
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 'p2', value: [] });
  });

  test('multi prompt keyboard: letters and space toggle, enter confirms, escape cancels', () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { ...msgs, 'prompt.pickup': 'Pick up what?' });
    m.ui.update(invView([]), [], multi);
    key('b');
    key('ArrowUp');
    key(' ');
    key('Enter');
    expect(m.acts).toEqual([{ type: 'answer', promptId: 'p1', value: [11, 12] }]);
    m.ui.update(invView([]), [], { ...multi, id: 'p3' });
    key('Escape');
    expect(m.acts.at(-1)).toEqual({ type: 'answer', promptId: 'p3', value: [] });
  });

  test('list event shows a closable sheet', () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { 'disc.title': 'Discoveries', ...msgs });
    m.ui.update(
      invView([]),
      [
        {
          type: 'list',
          titleKey: 'disc.title',
          items: [{ key: 'obj.dagger' }, { key: 'obj.mail' }],
        },
      ],
      null,
    );
    expect(m.root.querySelector('.nh-sheet-title')?.textContent).toBe('Discoveries');
    expect([...m.root.querySelectorAll('.nh-sheet-text')].map((e) => e.textContent)).toEqual([
      'a dagger',
      'a mail',
    ]);
    btns(m.root)[0]!.click();
    expect(btns(m.root)).toHaveLength(0);
  });

  test('look text includes the top object and a count of the rest', async () => {
    const m = mk();
    ui = m.ui;
    m.ui.api.addMessages('en', { ...msgs, 'nh:floor': 'floor' });
    m.ui.update(view(), [], null);
    m.renderer.cell = { x: 6, y: 5 };
    m.state.desc = {
      terrain: 'nh:floor',
      remembered: true,
      visible: true,
      entities: [],
      objects: [
        { id: 1, def: 'nh:dagger', name: { key: 'obj.dagger' } },
        { id: 2, def: 'nh:ration', name: { key: 'obj.ration' } },
        { id: 3, def: 'nh:mail', name: { key: 'obj.mail' } },
      ],
    };
    (m.root.querySelector('.nh-look-btn') as HTMLElement).click();
    tap(m.root.querySelector('.nh-map')!);
    await flush();
    expect(logText(m.root).at(-1)).toBe('You see: floor, a dagger, and 2 more objects.');
  });
});
