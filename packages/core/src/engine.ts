import { generateLevel, VANILLA_TERRAIN, type LevelTerrain } from './levelgen/index';
import { cellRules } from './movement';
import { createQuery } from './query';
import { loadMods, requireTerrains } from './registry';
import { createRng, newRngStates } from './rng';
import { parseSave, serializeSave } from './save';
import { getLevel, getPlayer, playerPos } from './state';
import { advanceTime } from './turn';
import type { PlayerAction } from './types/action';
import type { DefId, Json } from './types/common';
import { NORMAL_SPEED } from './types/entity';
import type { GameEvent } from './types/event';
import type { ActionDef, Ctx, Mod, Registry } from './types/mod';
import type { Replay } from './types/protocol';
import type { CoreQuery } from './types/query';
import type { GameState, StepResult } from './types/state';
import { computeVisible, newMemory, updateMemory } from './vision';

export const DEFAULT_WIDTH = 80;
export const DEFAULT_HEIGHT = 21;

export interface NewGameOptions {
  seed: number;
  width?: number;
  height?: number;
  /** Defaults to the first registered role. */
  role?: DefId;
}

export interface Engine {
  readonly registry: Registry;
  newGame(opts: NewGameOptions): StepResult;
  /** Mutates `state` in place and returns it in the result. */
  step(state: GameState, action: PlayerAction): StepResult;
  query(state: GameState): CoreQuery;
  save(state: GameState, replay: Replay): string;
  load(text: string): { state: GameState; replay: Replay };
}

export interface EngineOptions {
  /** Terrain ids the level generator uses. Defaults to the vanilla `nh:` set. */
  terrain?: LevelTerrain;
}

export class UnknownActionError extends Error {
  constructor(action: PlayerAction) {
    super(`No registered action handles ${JSON.stringify(action)}`);
    this.name = 'UnknownActionError';
  }
}

export function createEngine(mods: readonly Mod[], opts: EngineOptions = {}): Engine {
  const registry = loadMods(mods);
  const terrain = opts.terrain ?? VANILLA_TERRAIN;
  requireTerrains(registry, Object.values(terrain), 'levelgen');

  const makeCtx = (state: GameState, events: GameEvent[]): Ctx => {
    const ctx: Ctx = {
      state,
      rng: createRng(state.rng.core),
      cosmetic: createRng(state.rng.cosmetic),
      defs: registry,
      query: createQuery(registry, state),
      emit: (e) => void events.push(e),
      schedule(delay, kind, data: Json) {
        if (!Number.isInteger(delay) || delay < 1) throw new RangeError('Timer delay must be an integer >= 1');
        if (!registry.hasTimer(kind)) throw new Error(`Unknown timer '${kind}'`);
        const t = { at: state.turn + delay, seq: state.seq++, kind, data };
        const i = state.timers.findIndex((o) => o.at > t.at);
        state.timers.splice(i === -1 ? state.timers.length : i, 0, t);
      },
    };
    return ctx;
  };

  const refreshVision = (state: GameState): void => {
    const level = getLevel(state);
    const visible = computeVisible(level, cellRules(level, registry), playerPos(state));
    const memory = (state.memory[level.id] ??= newMemory(level));
    updateMemory(memory, level, visible);
    state.visible = visible;
  };

  const findHandler = (action: PlayerAction): ActionDef => {
    const def = registry.actions.find((a) =>
      action.type === 'mod' ? a.handles === 'mod' && a.id === action.action : a.handles === action.type,
    );
    if (!def) throw new UnknownActionError(action);
    return def;
  };

  const engine: Engine = {
    registry,

    newGame({ seed, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, role }) {
      const roleDef = role ? registry.role(role) : registry.roles[0];
      if (!roleDef) throw new Error('No player role registered');
      const s = seed >>> 0;
      const state: GameState = {
        version: 1,
        seed: s,
        turn: 1,
        nextEntityId: 1,
        seq: 0,
        rng: newRngStates(s),
        mods: registry.mods.map((m) => ({ id: m.id, version: m.version })),
        entities: {},
        levels: {},
        currentLevel: 'dlvl1',
        playerId: 0,
        memory: {},
        visible: [],
        timers: [],
        modData: {},
      };
      const events: GameEvent[] = [];
      const ctx = makeCtx(state, events);
      const level = generateLevel(ctx.rng, { id: 'dlvl1', depth: 1, width, height, terrain });
      state.levels[level.id] = level;
      // ref: src/allmain.c newgame() u_on_upstairs(); hero can move on the first turn
      const start = level.up ?? level.down;
      if (!start) throw new Error('Generated level has no stairs to start on');
      const id = state.nextEntityId++;
      state.playerId = id;
      state.entities[String(id)] = {
        id,
        def: roleDef.id,
        c: {
          pos: { level: level.id, x: start.x, y: start.y },
          actor: { energy: NORMAL_SPEED, speed: roleDef.speed },
          player: { role: roleDef.id },
        },
      };
      for (const h of registry.hooks('newLevel')) h.fn(ctx, level);
      refreshVision(state);
      events.unshift({ type: 'msg', key: 'welcome', params: { role: `@${roleDef.nameKey}` } });
      return { state, events, prompt: null };
    },

    step(state, action) {
      const events: GameEvent[] = [];
      const ctx = makeCtx(state, events);
      const def = findHandler(action);
      for (const h of registry.hooks('beforeAction')) {
        if (h.fn(ctx, action) === 'cancel') return { state, events, prompt: null };
      }
      const cost = def.perform(ctx, action);
      if (!Number.isInteger(cost) || cost < 0)
        throw new Error(`Action ${def.id} returned invalid energy cost ${cost}`);
      for (const h of registry.hooks('afterAction')) h.fn(ctx, action);
      const actor = getPlayer(state).c.actor;
      if (!actor) throw new Error('Player has no actor component');
      actor.energy -= cost;
      advanceTime(ctx);
      refreshVision(state);
      return { state, events, prompt: null };
    },

    query: (state) => createQuery(registry, state),
    save: (state, replay) => serializeSave(state, replay),
    load: (text) => parseSave(text, registry),
  };
  return engine;
}
