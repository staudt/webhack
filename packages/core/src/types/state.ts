import type { DefId, Json, LevelId, ModRef, RngState, EntityId } from './common';
import type { Entity } from './entity';
import type { Level } from './level';
import type { GameEvent } from './event';
import type { Prompt } from './prompt';

export interface Timer {
  at: number;
  seq: number;
  kind: DefId;
  data: Json;
}

export interface GameOver {
  kind: 'died' | 'escaped';
  /** Message param for the cause: a key, or '@' + a def id (e.g. '@nh:newt'). */
  killer: string;
  turn: number;
  depth: number;
  level: number;
}

/** A question awaiting the player's `{ type: 'answer' }`; `handler` is the ActionDef whose `answer` runs. */
export interface PendingPrompt {
  prompt: Prompt;
  handler: DefId;
  data: Json;
}

/** The whole game. JSON-plain: no classes, Map, Set, functions or typed arrays. */
export interface GameState {
  version: 3;
  seed: number;
  turn: number;
  nextEntityId: number;
  /** Monotonic tiebreaker for timers and other ordered records. */
  seq: number;
  rng: { core: RngState; cosmetic: RngState };
  /** Game mods in load order. */
  mods: ModRef[];
  /** Keyed by id; iterate with `sortedIds()`, never by key order. */
  entities: Record<string, Entity>;
  levels: Record<LevelId, Level>;
  currentLevel: LevelId;
  playerId: EntityId;
  /** Remembered palette index per cell; -1 = never seen. */
  memory: Record<LevelId, number[]>;
  /** Remembered top object per cell, as a shown id; keyed by cell index. */
  objectMemory: Record<LevelId, Record<string, DefId>>;
  /** Object def -> appearance def for randomized descriptions (ref: src/o_init.c shuffle_all). */
  appearances: Record<DefId, DefId>;
  /** Object defs whose identity the hero knows, sorted (ref: src/o_init.c discover_object). */
  discovered: DefId[];
  /** Sorted cell indices currently visible to the player. */
  visible: number[];
  /** Sorted by (at, seq). */
  timers: Timer[];
  /** Per-mod persistent data, keyed by mod id. */
  modData: Record<string, Json>;
  /** Set when the game has ended; every further action is rejected. */
  gameOver: GameOver | null;
  pendingPrompt: PendingPrompt | null;
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
  prompt: Prompt | null;
}
