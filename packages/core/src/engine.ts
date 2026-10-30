import { generateLevel, VANILLA_TERRAIN, type LevelTerrain } from './levelgen/index';
import { cellRules } from './movement';
import { createQuery } from './query';
import { loadMods, requireTerrains } from './registry';
import { createRng, newRngStates } from './rng';
import { parseSave, serializeSave } from './save';
import { getLevel, getPlayer, playerPos } from './state';
import { advanceTime } from './turn';
import type { PlayerAction } from './types/action';
import type { DefId, Json, Pos } from './types/common';
import { NORMAL_SPEED } from './types/entity';
import type { GameEvent } from './types/event';
import type { Level } from './types/level';
import type { ActionDef, Ctx, Mod, Registry } from './types/mod';
import type { Replay } from './types/protocol';
import type { CoreQuery } from './types/query';
import type { GameState, StepResult } from './types/state';
import { DIR_LIST, DIRS, cellIndex, inBounds, sortedIds } from './util';
import { computeVisible, newMemory, updateMemory } from './vision';

export const DEFAULT_WIDTH = 80;
export const DEFAULT_HEIGHT = 21;
/** Upper bound on repeats of one multi-turn action (travel) per step. */
export const MAX_REPEAT = 1000;

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

export const levelId = (depth: number): string => `dlvl${depth}`;

export function createEngine(mods: readonly Mod[], opts: EngineOptions = {}): Engine {
  const registry = loadMods(mods);
  const terrain = opts.terrain ?? VANILLA_TERRAIN;
  requireTerrains(registry, Object.values(terrain), 'levelgen');

  const occupied = (state: GameState, level: Level, x: number, y: number, except: number): boolean =>
    sortedIds(state).some((id) => {
      const p = state.entities[String(id)]?.c.pos;
      return id !== except && p !== undefined && p.level === level.id && p.x === x && p.y === y;
    });

  /** Nearest passable, unoccupied cell to `from` (breadth-first). ref: src/teleport.c enexto() */
  const nearestFree = (state: GameState, level: Level, from: Pos, except: number): Pos | null => {
    const rules = cellRules(level, registry);
    const seen = new Set<number>([cellIndex(level, from.x, from.y)]);
    const queue: Pos[] = [from];
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q] as Pos;
      for (const dir of DIR_LIST) {
        const x = p.x + DIRS[dir].x;
        const y = p.y + DIRS[dir].y;
        const i = cellIndex(level, x, y);
        if (!inBounds(level, x, y) || seen.has(i)) continue;
        seen.add(i);
        if (!rules.passable[level.cells[i] ?? 0]) continue;
        if (!occupied(state, level, x, y, except)) return { x, y };
        queue.push({ x, y });
      }
    }
    return null;
  };

  const makeCtx = (state: GameState, events: GameEvent[]): Ctx & { interrupted: boolean } => {
    const ctx: Ctx & { interrupted: boolean } = {
      state,
      rng: createRng(state.rng.core),
      cosmetic: createRng(state.rng.cosmetic),
      defs: registry,
      query: createQuery(registry, state),
      interrupted: false,
      emit: (e) => void events.push(e),
      schedule(delay, kind, data: Json) {
        if (!Number.isInteger(delay) || delay < 1)
          throw new RangeError('Timer delay must be an integer >= 1');
        if (!registry.hasTimer(kind)) throw new Error(`Unknown timer '${kind}'`);
        const t = { at: state.turn + delay, seq: state.seq++, kind, data };
        const i = state.timers.findIndex((o) => o.at > t.at);
        state.timers.splice(i === -1 ? state.timers.length : i, 0, t);
      },
      spawn(e) {
        const id = state.nextEntityId++;
        state.entities[String(id)] = { ...e, id };
        return id;
      },
      remove(id) {
        if (id === state.playerId) throw new Error('The hero cannot be removed');
        delete state.entities[String(id)];
      },
      goToLevel(depth, at) {
        if (!Number.isInteger(depth) || depth < 1) throw new RangeError(`Bad dungeon depth ${depth}`);
        const id = levelId(depth);
        const current = getLevel(state);
        let level = state.levels[id];
        if (!level) {
          level = generateLevel(ctx.rng, {
            id,
            depth,
            width: current.width,
            height: current.height,
            terrain,
          });
          state.levels[id] = level;
          state.memory[id] = newMemory(level);
          for (const h of registry.hooks('newLevel')) h.fn(ctx, level);
        }
        placeHero(state, level, at === 'up' ? level.up : level.down);
      },
      ask(prompt, handler, data) {
        const def = registry.actions.find((a) => a.id === handler);
        if (!def?.answer) throw new Error(`Prompt handler '${handler}' has no answer()`);
        state.pendingPrompt = { prompt, handler, data };
      },
      interrupt() {
        ctx.interrupted = true;
      },
      endGame(over) {
        state.gameOver ??= over;
      },
    };
    return ctx;
  };

  /**
   * Puts the hero on `target` (or any stairs) of `level` and makes it current. A monster on
   * that spot is moved to the nearest free cell. ref: src/do.c goto_level() u_on_newpos(), mnexto()
   */
  const placeHero = (state: GameState, level: Level, target: Pos | null): void => {
    const spot = target ?? level.up ?? level.down;
    if (!spot) throw new Error(`Level '${level.id}' has no stairs to arrive on`);
    const hero = getPlayer(state);
    for (const id of sortedIds(state)) {
      const e = state.entities[String(id)];
      const p = e?.c.pos;
      if (!e || id === hero.id || !p || p.level !== level.id || p.x !== spot.x || p.y !== spot.y)
        continue;
      const free = nearestFree(state, level, spot, id);
      if (free) e.c.pos = { level: level.id, x: free.x, y: free.y };
    }
    hero.c.pos = { level: level.id, x: spot.x, y: spot.y };
    state.currentLevel = level.id;
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
      action.type === 'mod'
        ? a.handles === 'mod' && a.id === action.action
        : a.handles === action.type,
    );
    if (!def) throw new UnknownActionError(action);
    return def;
  };

  const spend = (state: GameState, def: ActionDef, cost: number): void => {
    if (!Number.isInteger(cost) || cost < 0)
      throw new Error(`Action ${def.id} returned invalid energy cost ${cost}`);
    const actor = getPlayer(state).c.actor;
    if (!actor) throw new Error('Player has no actor component');
    actor.energy -= cost;
  };

  const result = (state: GameState, events: GameEvent[]): StepResult => ({
    state,
    events,
    prompt: state.pendingPrompt?.prompt ?? null,
  });

  const engine: Engine = {
    registry,

    newGame({ seed, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, role }) {
      const roleDef = role ? registry.role(role) : registry.roles[0];
      if (!roleDef) throw new Error('No player role registered');
      const s = seed >>> 0;
      const state: GameState = {
        version: 2,
        seed: s,
        turn: 1,
        nextEntityId: 1,
        seq: 0,
        rng: newRngStates(s),
        mods: registry.mods.map((m) => ({ id: m.id, version: m.version })),
        entities: {},
        levels: {},
        currentLevel: levelId(1),
        playerId: 0,
        memory: {},
        visible: [],
        timers: [],
        modData: {},
        gameOver: null,
        pendingPrompt: null,
      };
      const events: GameEvent[] = [];
      const ctx = makeCtx(state, events);
      // ref: src/allmain.c newgame(): u_init() before mklev() so generation can use the hero's level
      const id = state.nextEntityId++;
      state.playerId = id;
      state.entities[String(id)] = {
        id,
        def: roleDef.id,
        c: {
          // Hero can move on the first turn.
          actor: { energy: NORMAL_SPEED, speed: roleDef.speed },
          player: { role: roleDef.id },
        },
      };
      for (const h of registry.hooks('newGame')) h.fn(ctx, id);
      const level = generateLevel(ctx.rng, { id: levelId(1), depth: 1, width, height, terrain });
      state.levels[level.id] = level;
      state.memory[level.id] = newMemory(level);
      for (const h of registry.hooks('newLevel')) h.fn(ctx, level);
      // ref: src/allmain.c newgame() u_on_upstairs()
      placeHero(state, level, level.up);
      refreshVision(state);
      events.unshift({ type: 'msg', key: 'welcome', params: { role: `@${roleDef.nameKey}` } });
      return result(state, events);
    },

    step(state, action) {
      if (state.gameOver) throw new Error('The game is over');
      const events: GameEvent[] = [];
      const ctx = makeCtx(state, events);

      const pending = state.pendingPrompt;
      if (pending || action.type === 'answer') {
        if (!pending) throw new Error('There is no prompt to answer');
        if (action.type !== 'answer' || action.promptId !== pending.prompt.id)
          throw new Error(`Prompt '${pending.prompt.id}' must be answered first`);
        const def = registry.actions.find((a) => a.id === pending.handler);
        if (!def?.answer) throw new Error(`Prompt handler '${pending.handler}' has no answer()`);
        state.pendingPrompt = null;
        spend(state, def, def.answer(ctx, action.value, pending.data));
        advanceTime(ctx);
        refreshVision(state);
        return result(state, events);
      }

      const def = findHandler(action);
      for (let repeat = 0; repeat < MAX_REPEAT; repeat++) {
        if (registry.hooks('beforeAction').some((h) => h.fn(ctx, action) === 'cancel')) break;
        const cost = def.perform(ctx, action);
        spend(state, def, cost);
        refreshVision(state);
        for (const h of registry.hooks('afterAction')) h.fn(ctx, action);
        advanceTime(ctx);
        refreshVision(state);
        if (cost === 0 || ctx.interrupted || state.gameOver || state.pendingPrompt) break;
        if (!def.continues?.(ctx, action)) break;
      }
      return result(state, events);
    },

    query: (state) => createQuery(registry, state),
    save: (state, replay) => serializeSave(state, replay),
    load: (text) => parseSave(text, registry),
  };
  return engine;
}
