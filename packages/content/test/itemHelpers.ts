import {
  createEngine,
  createRng,
  getPlayer,
  type Entity,
  type EntityId,
  type GameEvent,
  type GameState,
  type Msg,
  type Params,
} from '@nh/core';
import { messagesEn, vanillaMod, type ItemCtx } from '../src/index';

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
  delete s.entities[String(s.playerId)]?.c.gear;
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
