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

/** The whole game. JSON-plain: no classes, Map, Set, functions or typed arrays. */
export interface GameState {
  version: 1;
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
  /** Sorted cell indices currently visible to the player. */
  visible: number[];
  /** Sorted by (at, seq). */
  timers: Timer[];
  /** Per-mod persistent data, keyed by mod id. */
  modData: Record<string, Json>;
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
  prompt: Prompt | null;
}
