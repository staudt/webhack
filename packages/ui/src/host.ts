import type {
  ActionOffer,
  ClientApi,
  ClientMod,
  Description,
  GameEvent,
  MenuItem,
  Params,
  PlayerAction,
  Pos,
  Prompt,
  Renderer,
  Target,
  AsyncCoreQuery,
  UiCommand,
  ViewUpdate,
} from '@nh/core';
import { ARROW_CODES, DEFAULT_CHORD_MS, createChord } from './chord';
import { attachKeyUp, attachKeys, attachTap } from './input';
import { DEFAULT_LOCALE, mergeMessages, translate, uiMessagesEn, type Catalogs } from './i18n';
import { buildLayout } from './layout';
import { Keymap } from './keymap';
import { openMenu, type MenuEntry, type OpenMenu } from './menu';
import { createMessageLog } from './messageLog';
import { injectStyles } from './styles';
import { an, ripArt, statusLines } from './status';

export interface GameClient {
  act(action: PlayerAction): void;
  query: AsyncCoreQuery;
}

export interface UiOptions {
  root: HTMLElement;
  renderer: Renderer;
  game: GameClient;
  mods: ClientMod[];
  locale?: string;
  /** Window for chording two arrow keys into a diagonal; 0 disables. Default 100. */
  chordWindowMs?: number;
  /** Called by the tombstone's New game button; falls back to the menu item with id 'new'. */
  onNewGame?: () => void;
}

export interface Ui {
  update(view: ViewUpdate, events: GameEvent[], prompt: Prompt | null): void;
  notify(key: string, params?: Params): void;
  readonly api: ClientApi;
  destroy(): void;
}

export function createUi(opts: UiOptions): Ui {
  const { root, renderer, game } = opts;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const doc = root.ownerDocument;
  const catalogs: Catalogs = { [DEFAULT_LOCALE]: { ...uiMessagesEn } };
  const keymap = new Keymap();
  const eventHandlers: ((e: GameEvent) => void)[] = [];
  const menuItems: MenuItem[] = [];
  const t = (key: string, params?: Params): string => translate(catalogs, locale, key, params);

  const style = injectStyles(doc);
  const log = createMessageLog(doc);
  const layout = buildLayout(root, log.el);
  const refreshText = (): void => {
    layout.menuBtn.textContent = '☰';
    layout.menuBtn.setAttribute('aria-label', t('ui.menu'));
    layout.actionsBtn.textContent = t('ui.actions');
    layout.lookBtn.textContent = t('ui.look.mode');
    log.setHistoryTitle(t('ui.history'));
  };

  const api: ClientApi = {
    bindKey: (key, cmd) => keymap.bind(key, cmd),
    addMessages: (loc, cat) => {
      mergeMessages(catalogs, loc, cat);
      refreshText();
    },
    setGlyph: (id, glyph) => renderer.setGlyph(id, glyph),
    onEvent: (fn) => {
      eventHandlers.push(fn);
    },
    addMenuItem: (item) => {
      menuItems.push(item);
    },
  };
  for (const mod of opts.mods) mod.register(api);
  refreshText();

  renderer.mount(layout.map);

  let destroyed = false;
  let playerPos: Pos | null = null;
  let lookMode = false;
  let modal: OpenMenu | null = null;
  let promptId: string | null = null;

  // Assigned once runCommand exists; showModal only runs after that.
  let chordReset = (): void => {};

  const closeModal = (): void => {
    const m = modal;
    modal = null;
    promptId = null;
    m?.close();
  };
  const showModal = (title: string, entries: MenuEntry[], dismissable: boolean): OpenMenu => {
    closeModal();
    chordReset();
    const m = openMenu(root, {
      title,
      entries,
      ...(dismissable ? { cancelLabel: t('ui.cancel') } : {}),
      onClose: () => {
        if (modal === m) modal = null;
      },
    });
    modal = m;
    return m;
  };

  const offerEntries = (offers: ActionOffer[]): MenuEntry[] =>
    offers.map((o) => ({ label: t(o.labelKey, o.params), run: () => game.act(o.action) }));

  const renderStatus = (s: ViewUpdate['status']): void => {
    const lines = statusLines(s).map((fields) => {
      const div = doc.createElement('div');
      div.className = 'nh-status-line';
      for (const f of fields) {
        const span = doc.createElement('span');
        span.textContent = f.text;
        if (f.cls) span.className = f.cls;
        div.append(span);
      }
      return div;
    });
    layout.status.replaceChildren(...lines.filter((l) => l.childElementCount > 0));
  };

  let tombstone = false;
  const newGame = (): void => {
    if (opts.onNewGame) opts.onNewGame();
    else menuItems.find((m) => m.id === 'new')?.run();
  };
  const showTombstone = (s: ViewUpdate['status']): void => {
    tombstone = true;
    const died = s['dead'] === 'died';
    const facts = [
      t('ui.rip.turn', { turn: Number(s['endTurn'] ?? s['turn'] ?? 0) }),
      t('ui.rip.dlvl', { dlvl: Number(s['endDepth'] ?? s['dlvl'] ?? 1) }),
      t('ui.rip.xl', { xl: Number(s['endLevel'] ?? s['xl'] ?? 1) }),
    ];
    let title: string;
    let body: string;
    if (died) {
      const k = String(s['killer'] ?? '');
      const def = k.startsWith('@') ? k.slice(1) : k;
      const killer = def ? an(t(def)) : '';
      const lines = [
        t('ui.rip.rest'),
        ...(killer ? [t('ui.rip.killed_by', { killer })] : []),
        ...facts,
      ];
      title = t('ui.rip.title');
      body = ripArt(lines);
    } else {
      title = t('ui.escaped');
      body = facts.join('\n');
    }
    const m = showModal(title, [{ label: t('ui.newgame'), run: newGame }], false);
    m.el.classList.add('nh-tomb');
    m.el
      .querySelector('.nh-sheet-title')
      ?.after(
        Object.assign(doc.createElement('pre'), { className: 'nh-sheet-body', textContent: body }),
      );
  };

  const setLook = (on: boolean): void => {
    lookMode = on;
    layout.lookBtn.setAttribute('aria-pressed', String(on));
  };

  const openActions = (target: Target): void => {
    void game.query.actionsFor(target).then((offers) => {
      if (destroyed) return;
      showModal(t('ui.actions'), offerEntries(offers), true);
    });
  };

  const openMainMenu = (): void => {
    showModal(
      t('ui.menu'),
      menuItems.map((it) => ({ label: t(it.labelKey), run: () => it.run() })),
      true,
    );
  };

  const describeLine = (d: Description): string => {
    const names = d.entities.map((e) => t(e.def));
    if (d.terrain !== null) names.push(t(d.terrain));
    if (names.length === 0) return t('describe.unexplored');
    let what = names.join(', ');
    if (d.remembered && !d.visible) what = t('ui.look.remembered', { what });
    return t('ui.look', { what });
  };

  const describe = (pos: Pos): void => {
    void game.query.describe(pos).then((d) => {
      if (destroyed) return;
      log.push(describeLine(d));
    });
  };

  const onTap = (x: number, y: number): void => {
    if (modal) return;
    const pos = renderer.cellAt(x, y);
    if (!pos) return;
    const wasLook = lookMode;
    if (wasLook) setLook(false);
    const p = playerPos;
    const dist = p ? Math.max(Math.abs(pos.x - p.x), Math.abs(pos.y - p.y)) : Infinity;
    if (!wasLook && dist === 0) {
      openActions({ kind: 'self' });
    } else if (wasLook) {
      describe(pos);
    } else {
      void game.query.actionsFor({ kind: 'cell', pos }).then((offers) => {
        if (destroyed) return;
        const [first] = offers;
        if (offers.length === 1 && first) game.act(first.action);
        else if (offers.length > 1) showModal(t('ui.actions'), offerEntries(offers), true);
        else describe(pos);
      });
    }
  };

  const runCommand = (cmd: UiCommand): void => {
    if (cmd.type === 'action') {
      game.act(cmd.action);
      return;
    }
    switch (cmd.id) {
      case 'menu':
        openMainMenu();
        break;
      case 'actions':
        openActions({ kind: 'self' });
        break;
      case 'look':
        setLook(!lookMode);
        break;
      default:
        menuItems.find((m) => m.id === cmd.id)?.run();
    }
  };

  const chord = createChord({
    windowMs: opts.chordWindowMs ?? DEFAULT_CHORD_MS,
    dispatch: runCommand,
  });
  chordReset = chord.reset;
  const win = doc.defaultView;
  win?.addEventListener('blur', chord.reset);
  const detachKeyUp = attachKeyUp(doc, (e) => chord.up(e.code));
  const detachKeys = attachKeys(doc, (e) => {
    if (modal) return modal.onKey(e);
    const cmd = keymap.resolve(e);
    if (!cmd) return false;
    if (ARROW_CODES.has(e.code)) {
      chord.down(e.code, e.repeat, cmd);
      return true;
    }
    runCommand(cmd);
    return true;
  });
  const detachTap = attachTap(layout.map, onTap);
  const onMenuBtn = (): void => {
    if (!modal) openMainMenu();
  };
  const onActionsBtn = (): void => {
    if (!modal) openActions({ kind: 'self' });
  };
  const onLookBtn = (): void => {
    if (!modal) setLook(!lookMode);
  };
  layout.menuBtn.addEventListener('click', onMenuBtn);
  layout.actionsBtn.addEventListener('click', onActionsBtn);
  layout.lookBtn.addEventListener('click', onLookBtn);

  const showPrompt = (p: Prompt): void => {
    const answer =
      (value: unknown): MenuEntry['run'] =>
      () =>
        game.act({ type: 'answer', promptId: p.id, value: value as never });
    const entries: MenuEntry[] =
      p.kind === 'yn' && !p.options
        ? [
            { label: t('ui.yes'), run: answer(true) },
            { label: t('ui.no'), run: answer(false) },
          ]
        : (p.options ?? []).map((o) => ({ label: t(o.key), run: answer(o.value) }));
    showModal(t(p.key, p.params), entries, false);
    promptId = p.id;
  };

  return {
    api,
    update(view, events, prompt) {
      if (destroyed) return;
      renderer.apply(view);
      renderStatus(view.status);
      playerPos = { x: view.player.x, y: view.player.y };
      for (const ev of events) {
        if (ev.type === 'msg') log.push(t(ev.key, ev.params));
        for (const fn of eventHandlers) fn(ev);
      }
      if (view.status['dead'] !== undefined) {
        if (!tombstone) showTombstone(view.status);
        return;
      }
      if (tombstone) {
        tombstone = false;
        closeModal();
      }
      if (prompt) {
        if (promptId !== prompt.id) showPrompt(prompt);
      } else if (promptId !== null) {
        closeModal();
      }
    },
    notify(key, params) {
      if (!destroyed) log.push(t(key, params));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeModal();
      detachKeys();
      detachKeyUp();
      win?.removeEventListener('blur', chord.reset);
      chord.reset();
      detachTap();
      layout.menuBtn.removeEventListener('click', onMenuBtn);
      layout.actionsBtn.removeEventListener('click', onActionsBtn);
      layout.lookBtn.removeEventListener('click', onLookBtn);
      renderer.destroy();
      root.replaceChildren();
      root.classList.remove('nh-ui');
      style.remove();
    },
  };
}
