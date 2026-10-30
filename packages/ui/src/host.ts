import type {
  ActionOffer,
  ClientApi,
  ClientMod,
  Description,
  Dir,
  GameEvent,
  Glyph,
  MenuItem,
  Params,
  PlayerAction,
  Pos,
  Prompt,
  Renderer,
  Target,
  AsyncCoreQuery,
  UiCommand,
  ViewItem,
  ViewUpdate,
} from '@nh/core';
import { ARROW_CODES, DEFAULT_CHORD_MS, createChord, dirOf } from './chord';
import { attachKeyUp, attachKeys, attachTap } from './input';
import { DEFAULT_LOCALE, mergeMessages, translate, uiMessagesEn, type Catalogs } from './i18n';
import { buildLayout } from './layout';
import { Keymap } from './keymap';
import { classKey, groupInventory } from './inventory';
import { openChecklist, openMenu, type MenuEntry, type OpenMenu } from './menu';
import { createMessageLog } from './messageLog';
import { injectStyles } from './styles';
import { an, ripArt, statusLines } from './status';

/** Window for a double tap on the map, in ms. */
export const DEFAULT_DOUBLE_TAP_MS = 350;

/**
 * Delay before the UI sends `continue` for the next move of a travel, run or meal, so the hero is
 * seen walking. A little faster than NetHack's runmode "walk" delay.
 */
export const DEFAULT_STEP_DELAY_MS = 60;

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
  /** Delay between the moves of a multi-turn action. Default {@link DEFAULT_STEP_DELAY_MS}. */
  stepDelayMs?: number;
  /** Called by the tombstone's New game button; falls back to the menu item with id 'new'. */
  onNewGame?: () => void;
  /**
   * Double-tap gesture on the map. The first tap acts at once; a second tap within `windowMs`
   * (default 350) of the first, on the same cell or next to it, performs the offer whose mod
   * action id is `action` among the cell's `actionsFor` offers (the game decides what it does,
   * e.g. a run). Offers with that id are never used for a single tap.
   */
  doubleTap?: { action: string; windowMs?: number };
  /**
   * Direction prefixes such as NetHack's `g` and `G`. A key bound to the ui command
   * `prefix:<name>` arms the prefix; the next direction key then performs `prefixes[name](dir)`.
   */
  prefixes?: Record<string, (dir: Dir) => PlayerAction>;
}

export interface Ui {
  /**
   * `continuing`: a multi-turn action is in progress. The UI sends `continue` after the step
   * delay until it ends; any input meanwhile cancels it and is swallowed.
   */
  update(view: ViewUpdate, events: GameEvent[], prompt: Prompt | null, continuing?: boolean): void;
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
  const glyphOverrides = new Map<string, Glyph>();
  let legend: Record<string, Glyph> = {};
  let inventory: ViewItem[] = [];
  let invOpen = false;
  const glyphOf = (id: string): Glyph | undefined => glyphOverrides.get(id) ?? legend[id];
  const t = (key: string, params?: Params): string => translate(catalogs, locale, key, params);

  const style = injectStyles(doc);
  const log = createMessageLog(doc);
  const layout = buildLayout(root, log.el);
  const refreshText = (): void => {
    layout.menuBtn.textContent = '☰';
    layout.menuBtn.setAttribute('aria-label', t('ui.menu'));
    layout.actionsBtn.textContent = t('ui.actions');
    layout.lookBtn.textContent = t('ui.look.mode');
    layout.inventoryBtn.textContent = t('ui.inventory');
    log.setHistoryTitle(t('ui.history'));
  };

  const api: ClientApi = {
    bindKey: (key, cmd) => keymap.bind(key, cmd),
    addMessages: (loc, cat) => {
      mergeMessages(catalogs, loc, cat);
      refreshText();
    },
    setGlyph: (id, glyph) => {
      glyphOverrides.set(id, glyph);
      renderer.setGlyph(id, glyph);
    },
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

  // Multi-turn actions (travel, run, meals) advance by `continue` messages, one per step delay.
  const stepDelayMs = opts.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;
  let stepTimer: ReturnType<typeof setTimeout> | null = null;
  /** A `continue` was sent and its view has not arrived yet. */
  let continueInFlight = false;
  /** The next view's `continuing` is ignored (the player cancelled while a continue was in flight). */
  let skipNextContinuing = false;
  const clearStepTimer = (): void => {
    if (stepTimer !== null) clearTimeout(stepTimer);
    stepTimer = null;
  };
  const isContinuing = (): boolean => stepTimer !== null || continueInFlight;
  /**
   * Input while a multi-turn action animates only cancels it: stops sending `continue` (the
   * engine drops the occupation with the next real action) and the input itself is swallowed.
   */
  const cancelContinuing = (): boolean => {
    if (!isContinuing()) return false;
    clearStepTimer();
    if (continueInFlight) skipNextContinuing = true;
    continueInFlight = false;
    chordReset();
    prefix = null;
    return true;
  };

  // Assigned once runCommand exists; showModal only runs after that.
  let chordReset = (): void => {};
  /** The armed direction prefix (see UiOptions.prefixes), if any. */
  let prefix: string | null = null;

  const closeModal = (): void => {
    const m = modal;
    modal = null;
    promptId = null;
    invOpen = false;
    m?.close();
  };
  const showSheet = (make: (onClose: () => void) => OpenMenu): OpenMenu => {
    closeModal();
    chordReset();
    prefix = null;
    const m: OpenMenu = make(() => {
      if (modal === m) {
        modal = null;
        invOpen = false;
      }
    });
    modal = m;
    return m;
  };
  const showModal = (
    title: string,
    entries: MenuEntry[],
    dismissable: boolean | string,
    sel?: number,
  ): OpenMenu =>
    showSheet((onClose) =>
      openMenu(root, {
        title,
        entries,
        ...(dismissable
          ? { cancelLabel: typeof dismissable === 'string' ? dismissable : t('ui.cancel') }
          : {}),
        ...(sel !== undefined ? { sel } : {}),
        onClose,
      }),
    );

  const offerEntries = (offers: ActionOffer[]): MenuEntry[] =>
    offers.map((o) => ({ label: t(o.labelKey, o.params), run: () => game.act(o.action) }));

  const renderStatus = (s: ViewUpdate['status']): void => {
    const lines = statusLines(s, t).map((fields) => {
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
      // Monster killers take an article ("a jackal"); 'killer.*' phrases are complete ("starvation").
      const killer = !def ? '' : def.startsWith('killer.') ? t(def) : an(t(def));
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

  // The item name (doname) already says "(weapon in hand)" / "(being worn)".
  const itemLabel = (it: ViewItem): string =>
    it.letter === null
      ? t('ui.item.unlettered', { name: it.name })
      : t('ui.item', { letter: it.letter, name: it.name });
  const itemEntry = (it: ViewItem, run: () => void): MenuEntry => {
    const glyph = glyphOf(it.g);
    return { label: itemLabel(it), run, ...(glyph ? { glyph } : {}) };
  };

  const openItemActions = (it: ViewItem): void => {
    void game.query.actionsFor({ kind: 'item', id: it.id }).then((offers) => {
      if (destroyed) return;
      showModal(itemLabel(it), offerEntries(offers), true);
    });
  };

  const inventoryEntries = (): MenuEntry[] => {
    if (inventory.length === 0)
      return [{ label: t('ui.inventory.empty'), run: () => {}, text: true }];
    const out: MenuEntry[] = [];
    for (const grp of groupInventory(inventory)) {
      out.push({ label: t(classKey(grp.cls)), run: () => {}, heading: true });
      for (const it of grp.items) out.push(itemEntry(it, () => openItemActions(it)));
    }
    return out;
  };
  const showInventory = (sel?: number): void => {
    showSheet((onClose) =>
      openMenu(root, {
        title: t('ui.inventory'),
        entries: inventoryEntries(),
        cancelLabel: t('ui.close'),
        ...(sel !== undefined ? { sel } : {}),
        onClose,
      }),
    );
    invOpen = true;
  };
  const openInventory = (): void => showInventory();

  /** Ask which inventory items offer `actionId` and let the player choose one. */
  /**
   * Item picker for a key like `e`: things on the floor offered for this action come first
   * (NetHack's "There is a X here; eat it?"), then inventory items that offer it.
   */
  const pickItem = (actionId: string): void => {
    const items = inventory;
    const matches = (x: ActionOffer): boolean =>
      x.action.type === 'mod' && x.action.action === actionId;
    void Promise.all([
      game.query.actionsFor({ kind: 'self' }),
      ...items.map((it) => game.query.actionsFor({ kind: 'item', id: it.id })),
    ]).then(([self, ...all]) => {
      if (destroyed) return;
      const entries: MenuEntry[] = (self ?? []).filter(matches).map((o) => ({
        label: t(o.labelKey, o.params),
        run: () => game.act(o.action),
      }));
      items.forEach((it, i) => {
        const o = all[i]?.find(matches);
        if (o) entries.push(itemEntry(it, () => game.act(o.action)));
      });
      if (entries.length === 0) log.push(t(`ui.pick.none.${actionId}`));
      else showModal(t(`ui.pick.${actionId}`), entries, true);
    });
  };

  /** Perform the self offer carrying mod action `actionId`, if there is one. */
  const selfAction = (actionId: string): void => {
    void game.query.actionsFor({ kind: 'self' }).then((offers) => {
      if (destroyed) return;
      const o = offers.find((x) => x.action.type === 'mod' && x.action.action === actionId);
      if (o) game.act(o.action);
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
    const [top] = d.objects;
    if (top) {
      names.push(t('ui.look.object', { name: top.name }));
      const more = d.objects.length - 1;
      if (more === 1) names.push(t('ui.look.more1'));
      else if (more > 1) names.push(t('ui.look.more', { n: more }));
    }
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

  const gestureAction = opts.doubleTap?.action;
  const doubleTapMs = opts.doubleTap?.windowMs ?? DEFAULT_DOUBLE_TAP_MS;
  const isGesture = (o: ActionOffer): boolean =>
    gestureAction !== undefined && o.action.type === 'mod' && o.action.action === gestureAction;
  let lastTap: { at: number; pos: Pos } | null = null;

  const onTap = (x: number, y: number): void => {
    if (modal) return;
    const pos = renderer.cellAt(x, y);
    if (!pos) return;
    const wasLook = lookMode;
    // A second tap soon after the first, on the same cell: the first already acted.
    const at = Date.now();
    const prev = lastTap;
    const double =
      !wasLook &&
      gestureAction !== undefined &&
      prev !== null &&
      at - prev.at <= doubleTapMs &&
      Math.max(Math.abs(pos.x - prev.pos.x), Math.abs(pos.y - prev.pos.y)) <= 1;
    // Any other tap while a travel or run animates just cancels it. A double tap's second tap
    // starts the run: the engine drops the first tap's travel when the run action arrives.
    if (double) cancelContinuing();
    else if (cancelContinuing()) return;
    if (wasLook) setLook(false);
    const p = playerPos;
    const dist = p ? Math.max(Math.abs(pos.x - p.x), Math.abs(pos.y - p.y)) : Infinity;
    lastTap = wasLook || double ? null : { at, pos };
    if (!wasLook && dist === 0) {
      // Not a menu after a double tap that has already brought the hero to this cell.
      if (!double) openActions({ kind: 'self' });
    } else if (wasLook) {
      describe(pos);
    } else {
      void game.query.actionsFor({ kind: 'cell', pos }).then((offers) => {
        if (destroyed) return;
        if (double) {
          const gesture = offers.find(isGesture);
          if (gesture) {
            game.act(gesture.action);
            return;
          }
        }
        const tapOffers = offers.filter((o) => !isGesture(o));
        const [first] = tapOffers;
        if (tapOffers.length === 1 && first) game.act(first.action);
        else if (tapOffers.length > 1) showModal(t('ui.actions'), offerEntries(offers), true);
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
      case 'inventory':
        openInventory();
        break;
      default:
        if (cmd.id.startsWith('pick:')) pickItem(cmd.id.slice(5));
        else if (cmd.id.startsWith('self:')) selfAction(cmd.id.slice(5));
        else menuItems.find((m) => m.id === cmd.id)?.run();
    }
  };

  /** Completes an armed prefix with a direction command, or runs the command. */
  const dispatchDirection = (cmd: UiCommand): void => {
    if (prefix === null) {
      runCommand(cmd);
      return;
    }
    const make = opts.prefixes?.[prefix];
    prefix = null;
    const dir = dirOf(cmd);
    if (make && dir !== null) game.act(make(dir as Dir));
  };
  const chord = createChord({
    windowMs: opts.chordWindowMs ?? DEFAULT_CHORD_MS,
    dispatch: dispatchDirection,
  });
  chordReset = chord.reset;
  const win = doc.defaultView;
  win?.addEventListener('blur', chord.reset);
  const detachKeyUp = attachKeyUp(doc, (e) => chord.up(e.code));
  let swallowUntil = -Infinity;
  const detachKeys = attachKeys(doc, (e) => {
    if (modal) return modal.onKey(e);
    // A cancel swallows its key, and any key pressed with it (the second arrow of a diagonal).
    const now = e.timeStamp;
    if (now < swallowUntil && e.key !== 'Shift') return true;
    if (e.key !== 'Shift' && cancelContinuing()) {
      swallowUntil = now + (opts.chordWindowMs ?? DEFAULT_CHORD_MS);
      return true;
    }
    const cmd = keymap.resolve(e);
    if (prefix !== null) {
      // The key after a prefix: a direction completes it; anything else cancels it.
      if (!cmd && e.key !== 'Escape') return false; // Shift alone, etc.
      if (cmd && ARROW_CODES.has(e.code) && dirOf(cmd) !== null) {
        // Arrows wait for the chord window, so Up+Left give one diagonal run.
        chord.down(e.code, e.repeat, cmd);
        return true;
      }
      const make = opts.prefixes?.[prefix];
      prefix = null;
      chord.reset();
      const dir = cmd ? dirOf(cmd) : null;
      if (make && cmd?.type === 'action' && dir !== null) game.act(make(dir as Dir));
      return true;
    }
    if (!cmd) return false;
    if (cmd.type === 'ui' && cmd.id.startsWith('prefix:')) {
      prefix = cmd.id.slice(7);
      return true;
    }
    if (ARROW_CODES.has(e.code)) {
      chord.down(e.code, e.repeat, cmd);
      return true;
    }
    runCommand(cmd);
    return true;
  });
  const detachTap = attachTap(layout.map, onTap);
  const onMenuBtn = (): void => {
    if (cancelContinuing()) return;
    if (!modal) openMainMenu();
  };
  const onActionsBtn = (): void => {
    if (cancelContinuing()) return;
    if (!modal) openActions({ kind: 'self' });
  };
  const onLookBtn = (): void => {
    if (cancelContinuing()) return;
    if (!modal) setLook(!lookMode);
  };
  const onInventoryBtn = (): void => {
    if (cancelContinuing()) return;
    if (!modal) openInventory();
  };
  layout.inventoryBtn.addEventListener('click', onInventoryBtn);
  layout.menuBtn.addEventListener('click', onMenuBtn);
  layout.actionsBtn.addEventListener('click', onActionsBtn);
  layout.lookBtn.addEventListener('click', onLookBtn);

  const showPrompt = (p: Prompt): void => {
    const answer =
      (value: unknown): MenuEntry['run'] =>
      () =>
        game.act({ type: 'answer', promptId: p.id, value: value as never });
    if (p.kind === 'menu' && p.multi) {
      const opts = p.options ?? [];
      showSheet((onClose) =>
        openChecklist(root, {
          title: t(p.key, p.params),
          options: opts.map((o) => {
            const glyph = o.glyph ? glyphOf(o.glyph) : undefined;
            return { label: t(o.key, o.params), ...(glyph ? { glyph } : {}) };
          }),
          confirmLabel: t('ui.confirm'),
          cancelLabel: t('ui.cancel'),
          onConfirm: (idx) => answer(idx.flatMap((i) => (opts[i] ? [opts[i].value] : [])))(),
          onCancel: () => answer([])(),
          onClose,
        }),
      );
      promptId = p.id;
      return;
    }
    const entries: MenuEntry[] =
      p.kind === 'yn' && !p.options
        ? [
            { label: t('ui.yes'), run: answer(true) },
            { label: t('ui.no'), run: answer(false) },
          ]
        : (p.options ?? []).map((o) => {
            const glyph = o.glyph ? glyphOf(o.glyph) : undefined;
            return { label: t(o.key, o.params), run: answer(o.value), ...(glyph ? { glyph } : {}) };
          });
    showModal(t(p.key, p.params), entries, false);
    promptId = p.id;
  };

  return {
    api,
    update(view, events, prompt, continuing = false) {
      if (destroyed) return;
      clearStepTimer();
      continueInFlight = false;
      const keepGoing = continuing && !skipNextContinuing;
      skipNextContinuing = false;
      renderer.apply(view);
      if (view.kind === 'full') legend = view.legend;
      inventory = view.inventory;
      renderStatus(view.status);
      playerPos = { x: view.player.x, y: view.player.y };
      let listEv: Extract<GameEvent, { type: 'list' }> | null = null;
      for (const ev of events) {
        if (ev.type === 'msg') log.push(t(ev.key, ev.params));
        else if (ev.type === 'list') listEv = ev;
        for (const fn of eventHandlers) fn(ev);
      }
      if (view.status['dead'] !== undefined) {
        if (!tombstone) showTombstone(view.status);
        return;
      }
      if (keepGoing && !prompt && !listEv) {
        stepTimer = setTimeout(() => {
          stepTimer = null;
          continueInFlight = true;
          game.act({ type: 'continue' });
        }, stepDelayMs);
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
      if (listEv && !prompt) {
        const ev = listEv;
        showModal(
          t(ev.titleKey),
          [
            ...ev.items.map((m) => ({
              label: t(m.key, m.params),
              run: () => {},
              text: true,
            })),
          ],
          t('ui.close'),
        );
      } else if (invOpen && modal) {
        showInventory(modal.getSel());
      }
    },
    notify(key, params) {
      if (!destroyed) log.push(t(key, params));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearStepTimer();
      closeModal();
      detachKeys();
      detachKeyUp();
      win?.removeEventListener('blur', chord.reset);
      chord.reset();
      detachTap();
      layout.inventoryBtn.removeEventListener('click', onInventoryBtn);
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
