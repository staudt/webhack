import { createEngine, type Engine, type EngineOptions } from './engine';
import { stateHash } from './hash';
import type { Json } from './types/common';
import type { GameEvent } from './types/event';
import type { Mod } from './types/mod';
import type { FromCore, Replay, ToCore } from './types/protocol';
import type { GameState } from './types/state';
import type { ViewSnapshot } from './types/view';
import { applyUpdate, buildSnapshot, diffSnapshot } from './view';

export interface Host {
  handle(msg: ToCore): void;
}

const QUERIES = ['describe', 'actionsFor', 'pathTo'] as const;

/** Worker-side protocol handler. Pure: the caller wires `post` to postMessage. */
export function createHost(
  mods: readonly Mod[],
  post: (m: FromCore) => void,
  opts?: EngineOptions,
): Host {
  const engine: Engine = createEngine(mods, opts);
  let game: { state: GameState; replay: Replay } | null = null;
  let mirror: ViewSnapshot | null = null;

  const requireGame = (): { state: GameState; replay: Replay } => {
    if (!game) throw new Error('No game in progress');
    return game;
  };

  const sendFull = (state: GameState, events: GameEvent[]): void => {
    mirror = buildSnapshot(engine.registry, state);
    post({ t: 'view', view: mirror, events, prompt: null });
  };

  const dispatch = (msg: ToCore): void => {
    switch (msg.t) {
      case 'new': {
        const { state, events } = engine.newGame({
          seed: msg.seed,
          width: msg.width,
          height: msg.height,
        });
        const level = state.levels[state.currentLevel];
        game = {
          state,
          replay: {
            seed: state.seed,
            width: level ? level.width : msg.width,
            height: level ? level.height : msg.height,
            mods: state.mods.map((m) => ({ ...m })),
            actions: [],
          },
        };
        sendFull(state, events);
        return;
      }
      case 'load': {
        const loaded = engine.load(msg.save);
        game = loaded;
        const role = loaded.state.entities[String(loaded.state.playerId)]?.c.player?.role;
        if (!role) throw new Error('Saved game has no player role');
        // ref: src/allmain.c welcome()
        const events: GameEvent[] = [
          {
            type: 'msg',
            key: 'welcome.back',
            params: { role: '@' + engine.registry.role(role).nameKey },
          },
        ];
        sendFull(loaded.state, events);
        return;
      }
      case 'act': {
        const g = requireGame();
        const { events, prompt } = engine.step(g.state, msg.action);
        g.replay.actions.push(JSON.parse(JSON.stringify(msg.action)) as typeof msg.action);
        const next = buildSnapshot(engine.registry, g.state);
        const view = mirror ? diffSnapshot(mirror, next) : next;
        mirror = applyUpdate(mirror, view);
        post({ t: 'view', view, events, prompt });
        return;
      }
      case 'query': {
        const g = requireGame();
        const q = msg.q as string;
        if (!(QUERIES as readonly string[]).includes(q)) throw new Error(`unknown query '${q}'`);
        const fn = engine.query(g.state)[q as (typeof QUERIES)[number]] as (
          ...a: unknown[]
        ) => unknown;
        const result = fn(...msg.args) as Json;
        post({ t: 'reply', id: msg.id, result });
        return;
      }
      case 'save': {
        const g = requireGame();
        post({ t: 'saved', save: engine.save(g.state, g.replay) });
        return;
      }
      case 'hash': {
        post({ t: 'hash', hash: stateHash(requireGame().state) });
        return;
      }
      default: {
        throw new Error(`Unknown message type '${String((msg as { t?: unknown }).t)}'`);
      }
    }
  };

  return {
    handle(msg) {
      try {
        dispatch(msg);
      } catch (err) {
        const base = err instanceof Error ? err.message : String(err);
        const message = msg && msg.t === 'query' ? `query ${msg.id}: ${base}` : base;
        post({ t: 'error', message });
      }
    },
  };
}
