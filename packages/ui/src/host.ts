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
import { attachKeyUp, attachKeys, attachPinch, attachTap } from './input';
import { openCompass, openTextPrompt } from './compass';
import { clampCell, pinchCell } from './pinch';
import {
  DEFAULT_LOCALE,
  hasMessage,
  mergeMessages,
  translate,
  uiMessagesEn,
  type Catalogs,
} from './i18n';
import { buildLayout } from './layout';
import { Keymap } from './keymap';
import { classKey, groupInventory } from './inventory';
import { openChecklist, openMenu, type MenuEntry, type OpenMenu } from './menu';
import { createMessageLog } from './messageLog';
import { injectStyles } from './styles';
import { an, ripArt, statusLines } from './status';

/**
 * Delay before the UI sends `continue` for the next move of a travel, run or meal, so the hero is
 * seen walking. A little faster than NetHack's runmode "walk" delay.
 */
export const DEFAULT_STEP_DELAY_MS = 60;

/**
 * What a renderer may offer for zoom (the ASCII renderer does); the UI feature-detects it so
 * other renderers need not implement it.
 */
export interface ZoomableRenderer {
  setFit(on: boolean): void;
  setZoom(cellCssPx: number): void;
  resetZoom(): void;
  getCell(): number;
}
const isZoomable = (r: object): r is ZoomableRenderer =>
  typeof (r as Partial<ZoomableRenderer>).setFit === 'function' &&
  typeof (r as Partial<ZoomableRenderer>).setZoom === 'function' &&
  typeof (r as Partial<ZoomableRenderer>).getCell === 'function';

/**
 * What a renderer may offer to draw a thrown object in flight: a glyph (by legend id) over one
 * cell, or none (`null`) to remove it. Feature-detected like {@link ZoomableRenderer}.
 */
export interface FlashRenderer {
  flash(pos: Pos, g: string | null): void;
}
const isFlashable = (r: object): r is FlashRenderer =>
  typeof (r as Partial<FlashRenderer>).flash === 'function';

/** localStorage key of the per-device zoom: `fit`, or the cell width in CSS px. */
export const ZOOM_STORAGE_KEY = 'nh.zoom';

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
  let zoomFit = false;
  const refreshText = (): void => {
    layout.menuBtn.textContent = '☰';
    layout.menuBtn.setAttribute('aria-label', t('ui.menu'));
    layout.actionsBtn.textContent = t('ui.actions');
    layout.lookBtn.textContent = t('ui.look.mode');
    layout.zoomBtn.textContent = '⤢';
    layout.zoomBtn.setAttribute('aria-label', t(zoomFit ? 'ui.zoom.normal' : 'ui.zoom.fit'));
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

  // Zoom: fit-to-width toggle and pinch, remembered per device.
  const zoomer: ZoomableRenderer | null = isZoomable(renderer) ? renderer : null;
  let zoomCell: number | null = null; // the pinched cell width, null = normal
  const store = (): Storage | null => {
    try {
      return doc.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  };
  const saveZoom = (): void => {
    try {
      store()?.setItem(
        ZOOM_STORAGE_KEY,
        zoomFit ? 'fit' : zoomCell === null ? '' : String(zoomCell),
      );
    } catch {
      /* storage unavailable: the zoom just is not remembered */
    }
  };
  const applyZoom = (): void => {
    if (!zoomer) return;
    if (zoomFit) zoomer.setFit(true);
    else if (zoomCell !== null) zoomer.setZoom(zoomCell);
    else zoomer.resetZoom();
    layout.zoomBtn.setAttribute('aria-pressed', String(zoomFit));
    layout.zoomBtn.setAttribute('aria-label', t(zoomFit ? 'ui.zoom.normal' : 'ui.zoom.fit'));
  };
  if (zoomer) {
    try {
      const saved = store()?.getItem(ZOOM_STORAGE_KEY);
      if (saved === 'fit') zoomFit = true;
      else if (saved && Number.isFinite(Number(saved))) zoomCell = clampCell(Number(saved));
    } catch {
      /* ignore */
    }
    if (zoomFit || zoomCell !== null) applyZoom();
  } else layout.zoomBtn.hidden = true;

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
  // Projectile flights: the update that carries them is held back until the flight is drawn.
  const flasher: FlashRenderer | null = isFlashable(renderer) ? renderer : null;
  let anim: { timer: ReturnType<typeof setTimeout>; done: () => void } | null = null;
  /** Ends a flight at once (dropping the remaining frames) and applies the held-back update. */
  function finishAnimation(): void {
    const a = anim;
    if (!a) return;
    anim = null;
    clearTimeout(a.timer);
    flasher?.flash({ x: 0, y: 0 }, null);
    a.done();
  }
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
    finishAnimation(); // a flight in progress is skipped; the input is then handled normally
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
    const lines = statusLines(s, t, (k) => hasMessage(catalogs, locale, k)).map((fields) => {
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

  const onTap = (x: number, y: number): void => {
    if (modal) return;
    const pos = renderer.cellAt(x, y);
    if (!pos) return;
    const wasLook = lookMode;
    // Any other tap while a travel or run animates just cancels it.
    if (cancelContinuing()) return;
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
    if (modal?.pickDir) {
      const d = dirOf(cmd);
      if (d !== null) modal.pickDir(d);
      return;
    }
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
    if (modal) {
      if (e.ctrlKey) return false;
      if (modal.pickDir && ARROW_CODES.has(e.code)) {
        // Arrows wait for the chord window, so Up+Left pick one diagonal.
        const cmd = keymap.resolve(e);
        if (cmd && dirOf(cmd) !== null) {
          chord.down(e.code, e.repeat, cmd);
          return true;
        }
      }
      return modal.onKey(e);
    }
    // A cancel swallows its key, and any key pressed with it (the second arrow of a diagonal).
    const now = e.timeStamp;
    if (now < swallowUntil && e.key !== 'Shift') return true;
    if (e.key !== 'Shift' && cancelContinuing()) {
      swallowUntil = now + (opts.chordWindowMs ?? DEFAULT_CHORD_MS);
      return true;
    }
    const cmd = keymap.resolve(e);
    if (e.ctrlKey && !cmd) return false;
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
  let pinchStart = 0;
  const detachPinch = attachPinch(layout.map, {
    onStart: () => {
      if (modal || !zoomer) return;
      cancelContinuing();
      pinchStart = zoomer.getCell();
    },
    onScale: (scale) => {
      if (!zoomer || pinchStart === 0) return;
      const cell = pinchCell(pinchStart, 1, scale);
      zoomFit = false;
      zoomCell = cell;
      layout.zoomBtn.setAttribute('aria-pressed', 'false');
      zoomer.setZoom(cell);
    },
    onEnd: () => {
      if (pinchStart === 0) return;
      pinchStart = 0;
      saveZoom();
      refreshText();
    },
  });
  const onZoomBtn = (): void => {
    if (cancelContinuing()) return;
    if (modal || !zoomer) return;
    zoomFit = !zoomFit;
    applyZoom();
    saveZoom();
    refreshText();
  };
  layout.zoomBtn.addEventListener('click', onZoomBtn);
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
            return {
              label: t(o.key, o.params),
              ...(glyph ? { glyph } : {}),
              ...(o.max !== undefined && o.max > 1 ? { max: o.max } : {}),
            };
          }),
          confirmLabel: t('ui.confirm'),
          cancelLabel: t('ui.cancel'),
          lessLabel: t('ui.count.less'),
          moreLabel: t('ui.count.more'),
          // A count below the stack size answers { value, count }; the whole stack is the value.
          onConfirm: (chosen) =>
            answer(
              chosen.flatMap(({ index, count }) => {
                const o = opts[index];
                if (!o) return [];
                return [o.max !== undefined && count < o.max ? { value: o.value, count } : o.value];
              }),
            )(),
          onCancel: () => answer([])(),
          onClose,
        }),
      );
      promptId = p.id;
      return;
    }
    if (p.kind === 'direction') {
      const opts = p.options ?? [];
      const known = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
      const valueOf = new Map<string, unknown>();
      for (const o of opts)
        if (typeof o.value === 'string' && known.has(o.value)) valueOf.set(o.value, o.value);
      showSheet((onClose) =>
        openCompass(root, {
          title: t(p.key, p.params),
          enabled: new Set(valueOf.keys()),
          cancelLabel: t('ui.compass.cancel'),
          dirLabels: Object.fromEntries(
            opts.flatMap((o) =>
              typeof o.value === 'string' ? [[o.value, t(o.key, o.params)]] : [],
            ),
          ),
          extras: opts
            .filter((o) => !(typeof o.value === 'string' && known.has(o.value)))
            .map((o) => ({ label: t(o.key, o.params), run: answer(o.value) })),
          onPick: (dir) => answer(valueOf.get(dir))(),
          onCancel: () => answer(null)(),
          onClose,
        }),
      );
      promptId = p.id;
      return;
    }
    if (p.kind === 'text') {
      showSheet((onClose) =>
        openTextPrompt(root, {
          title: t(p.key, p.params),
          maxLength: p.maxLength ?? 80,
          okLabel: t('ui.text.ok'),
          cancelLabel: t('ui.cancel'),
          onSubmit: (text) => answer(text)(),
          onCancel: () => answer(null)(),
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
      finishAnimation();
      const frames: { pos: Pos; g: string }[] = [];
      if (flasher)
        for (const ev of events)
          if (ev.type === 'projectile') for (const pos of ev.path) frames.push({ pos, g: ev.g });
      if (frames.length === 0) {
        applyUpdate(view, events, prompt, continuing);
        return;
      }
      // One cell per step, like a walking hero; then the view, messages and the next `continue`.
      let i = 0;
      const next = (): void => {
        const f = frames[i++];
        if (!f) {
          finishAnimation();
          return;
        }
        flasher?.flash(f.pos, f.g);
        anim = { timer: setTimeout(next, stepDelayMs), done };
      };
      const done = (): void => applyUpdate(view, events, prompt, continuing);
      next();
    },
    notify(key, params) {
      if (!destroyed) log.push(t(key, params));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (anim) clearTimeout(anim.timer);
      anim = null;
      clearStepTimer();
      closeModal();
      detachKeys();
      detachKeyUp();
      win?.removeEventListener('blur', chord.reset);
      chord.reset();
      detachTap();
      detachPinch();
      layout.zoomBtn.removeEventListener('click', onZoomBtn);
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

  function applyUpdate(
    view: ViewUpdate,
    events: GameEvent[],
    prompt: Prompt | null,
    continuing: boolean,
  ): void {
    {
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
    }
  }
}
