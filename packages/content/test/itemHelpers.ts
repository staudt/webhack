import {
  createEngine,
  createRng,
  getPlayer,
  inventoryOf,
  type Entity,
  type EntityId,
  type GameEvent,
  type GameState,
  type Msg,
  type Params,
} from '@nh/core';
import { messagesEn, mksobj, vanillaMod, type ItemCtx } from '../src/index';

export const engine = createEngine([vanillaMod]);
export const defs = engine.registry;
export const obj = (id: string) => defs.object(id as never);

export interface TestCtx extends ItemCtx {
  events: GameEvent[];
}

/** A minimal Ctx for the item functions; its rng draws from (and advances) the state's. */
export function ctxFor(state: GameState): TestCtx {
  const events: GameEvent[] = [];
  return {
    state,
    rng: createRng(state.rng.core),
    defs,
    events,
    emit: (e) => events.push(e),
    spawn: (e) => {
      const id = state.nextEntityId++;
      state.entities[String(id)] = { ...e, id };
      return id;
    },
    remove: (id) => {
      delete state.entities[String(id)];
    },
  };
}

export const freshState = (seed = 1): GameState => engine.newGame({ seed }).state;
export const heroOf = (s: GameState): Entity => getPlayer(s);
export const itemOf = (s: GameState, id: EntityId) => {
  const it = s.entities[String(id)]?.c.item;
  if (!it) throw new Error(`no item ${id}`);
  return it;
};

/** Plain items: no hero kit, so tests control the inventory completely. */
export function bareState(seed = 1): GameState {
  const s = freshState(seed);
  for (const k of Object.keys(s.entities)) {
    if (s.entities[k]?.c.item) delete s.entities[k];
  }
  s.modData = {};
  return s;
}

/** Renders a Msg with the English catalog; `{x|an}` adds a/an unless the text starts with a digit. */
export function render(msg: Msg | string, cat: Record<string, string> = messagesEn): string {
  if (typeof msg === 'string')
    return msg.startsWith('@') ? render({ key: msg.slice(1) }, cat) : msg;
  const tpl = cat[msg.key];
  if (tpl === undefined) throw new Error(`no message ${msg.key}`);
  const params: Params = msg.params ?? {};
  return tpl.replace(/\{(\w+)(?:\|(\w+))?\}/g, (_m, name: string, mod?: string) => {
    const v = params[name];
    const text = v === undefined ? '' : typeof v === 'number' ? String(v) : render(v, cat);
    if (mod !== 'an') return text;
    if (/^[0-9]/.test(text)) return text;
    return `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;
  });
}

// ---- a small level for the item action tests ----
import { newMemory, type DefId, type Level, type PlayerAction, type StepResult } from '@nh/core';
import { T } from '../src/index';

/** Hero (with the real kit) on a lit floor strip; other entities are removed. `@` marks her. */
export function levelSetup(rows: string[] = ['.....', '..@..', '.....'], seed = 1) {
  const { state } = engine.newGame({ seed });
  for (const k of Object.keys(state.entities)) {
    const e = state.entities[k];
    if (e && !e.c.item && Number(k) !== state.playerId) delete state.entities[k];
    else if (e?.c.item && !e.c.item.carriedBy) delete state.entities[k];
  }
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const palette: DefId[] = [T.stone, T.floor];
  const cells: number[] = [];
  let start = { x: 0, y: 0 };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const ch = rows[y]?.[x] ?? ' ';
      if (ch === '@') start = { x, y };
      cells.push(ch === ' ' ? 0 : 1);
    }
  const level: Level = {
    id: 'dlvl1',
    depth: 1,
    width,
    height,
    palette,
    cells,
    lit: cells.map(() => 1),
    rooms: [],
    up: null,
    down: null,
  };
  state.levels['dlvl1'] = level;
  state.memory['dlvl1'] = newMemory(level);
  state.currentLevel = 'dlvl1';
  const hero = getPlayer(state);
  if (hero.c.pos) Object.assign(hero.c.pos, { level: 'dlvl1', x: start.x, y: start.y });
  if (hero.c.hp) hero.c.hp = { cur: 500, max: 500 };
  const step = (a: PlayerAction): StepResult => engine.step(state, a);
  const mod = (action: string, args?: Record<string, unknown>): StepResult =>
    step({ type: 'mod', action: action as DefId, ...(args ? { args: args as never } : {}) });
  const msgKeys = (r: StepResult): string[] =>
    r.events.flatMap((e) => (e.type === 'msg' ? [e.key] : []));
  /** All message text of a step, rendered. */
  const text = (r: StepResult): string[] =>
    r.events.flatMap((e) =>
      e.type === 'msg' ? [render({ key: e.key, ...(e.params ? { params: e.params } : {}) })] : [],
    );
  const ctx = ctxFor(state);
  const here = { level: 'dlvl1', x: start.x, y: start.y };
  /** Puts a new item on the hero's cell (or in her inventory with `carry`). */
  const give = (id: string, o: Parameters<typeof mksobj>[2] = {}): EntityId =>
    mksobj(ctx, obj(id), { init: false, ...o });
  const floor = (id: string, o: Parameters<typeof mksobj>[2] = {}): EntityId =>
    give(id, { at: here, ...o });
  const carry = (id: string, o: Parameters<typeof mksobj>[2] = {}): EntityId =>
    give(id, { carriedBy: state.playerId, ...o });
  const letterOf = (id: EntityId) => itemOf(state, id).letter;
  const byLetter = (l: string): EntityId => {
    const e = inventoryOf(state, state.playerId).find((o) => o.c.item?.letter === l);
    if (!e) throw new Error(`no item ${l}`);
    return e.id;
  };
  return {
    state,
    ctx,
    hero,
    step,
    mod,
    msgKeys,
    text,
    give,
    floor,
    carry,
    letterOf,
    byLetter,
    here,
  };
}

/** Makes the kit uncursed (the real kit may be randomly blessed) so names are predictable. */
export function plainKit(state: GameState): void {
  for (const e of inventoryOf(state, state.playerId)) {
    if (e.c.item) e.c.item.buc = 'uncursed';
  }
}

/** "a - an uncursed +1 spear (weapon in hand)" for an inventory item. */
export function invLine(state: GameState, e: Entity): string {
  return render({
    key: 'inv.menu_item',
    params: { letter: e.c.item?.letter ?? '?', item: defs.itemName(state, e) },
  });
}
