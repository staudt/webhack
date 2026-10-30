import type { ActionType, PlayerAction } from './action';
import type { DefId, EntityId, Glyph, Json } from './common';
import type { Entity } from './entity';
import type { GameEvent } from './event';
import type { Level } from './level';
import type { ActionOffer, CoreQuery, Target } from './query';
import type { Rng } from './rng';
import type { GameOver, GameState } from './state';
import type { Prompt } from './prompt';

export interface TerrainDef {
  id: DefId;
  nameKey: string;
  passable: boolean;
  opaque: boolean;
  door?: 'closed' | 'open' | 'doorway';
  stairs?: 'up' | 'down';
  glyph: Glyph;
  /** Hidden terrain (secret doors/corridors) is shown to clients as this terrain instead. */
  looksLike?: DefId;
}

export interface RoleDef {
  id: DefId;
  nameKey: string;
  speed: number;
  /** The player's map glyph; the player entity's `def` is the role id. */
  glyph: Glyph;
}

/** An offer as returned by `ActionDef.offer`; the engine adds `source`. */
export type Offer = Omit<ActionOffer, 'source'>;

export interface ActionDef {
  id: DefId;
  labelKey: string;
  /** Which PlayerAction type this def performs. Built-ins use their own type; mod actions use 'mod' and match on `action.action === id`. */
  handles: ActionType;
  /** Offers this action contributes to `actionsFor(target)`. */
  offer(ctx: Ctx, target: Target): Offer[];
  /** Performs the action; returns the energy cost (0 = no time passes). */
  perform(ctx: Ctx, action: PlayerAction): number;
  /** Handles the answer to a prompt this action raised with `ctx.ask`; returns the energy cost. */
  answer?(ctx: Ctx, value: Json, data: Json): number;
  /**
   * Multi-turn actions (travel): after each performed step and the monsters' turns, the engine
   * performs the action again while this returns true, nothing interrupted, and time passed.
   */
  continues?(ctx: Ctx, action: PlayerAction): boolean;
}

/** ref: include/monattk.h AT_* */
export type AttackType =
  | 'claw'
  | 'bite'
  | 'kick'
  | 'butt'
  | 'touch'
  | 'sting'
  | 'hug'
  | 'spit'
  | 'engulf'
  | 'breath'
  | 'explode'
  | 'boom'
  | 'gaze'
  | 'tentacle'
  | 'weapon'
  | 'magic';

/** ref: include/monattk.h; only 'phys' damage is implemented in milestone 2. */
export interface AttackDef {
  at: AttackType;
  ad: string;
  n: number;
  d: number;
}

/** ref: include/permonst.h struct permonst */
export interface MonsterDef {
  id: DefId;
  nameKey: string;
  glyph: Glyph;
  level: number;
  speed: number;
  ac: number;
  mr: number;
  alignment: number;
  attacks: AttackDef[];
  size: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gigantic';
  /** Lowercased M1_/M2_/M3_ flag names without prefix, e.g. 'animal', 'nohands', 'hostile'. */
  flags: string[];
  /** Generation frequency 0..7 (G_FREQ); 0 = never randomly generated. */
  frequency: number;
  group: 'small' | 'large' | null;
  /** Extra generation flags, e.g. 'nogen', 'nohell', 'genocidable'. */
  genFlags: string[];
  difficulty: number;
  /** BrainDef that runs this monster's turns. */
  brain: DefId;
}

/** Runs a non-hero actor's turn. The engine deducts NORMAL_SPEED before calling `act`. */
export interface BrainDef {
  id: DefId;
  act(ctx: Ctx, self: EntityId): void;
  /** Movement gained at the end of each turn (ref: src/mon.c mcalcmove); defaults to actor speed. */
  movement?(ctx: Ctx, self: EntityId): number;
}

/** Fires when a scheduled timer comes due at end of turn. */
export interface TimerDef {
  id: DefId;
  fire(ctx: Ctx, data: Json): void;
}

export interface Ctx {
  readonly state: GameState;
  rng: Rng;
  cosmetic: Rng;
  defs: Registry;
  emit(e: GameEvent): void;
  query: CoreQuery;
  /** Schedule a registered timer to fire `delay` (>= 1) turns from now. */
  schedule(delay: number, kind: DefId, data: Json): void;
  /** Adds an entity and returns its new id. */
  spawn(e: Omit<Entity, 'id'>): EntityId;
  /** Removes an entity (never the hero). */
  remove(id: EntityId): void;
  /**
   * Moves the hero to dungeon level `depth`, generating it on first visit, arriving on its
   * up or down staircase.
   */
  goToLevel(depth: number, at: 'up' | 'down'): void;
  /** Ends this step with `prompt`; the next action must answer it and is routed to `handler`. */
  ask(prompt: Prompt, handler: DefId, data: Json): void;
  /** Stops a multi-turn action after the current step. */
  interrupt(): void;
  endGame(over: GameOver): void;
}

export interface Hooks {
  beforeAction(ctx: Ctx, a: PlayerAction): 'continue' | 'cancel';
  afterAction(ctx: Ctx, a: PlayerAction): void;
  endOfTurn(ctx: Ctx): void;
  /** Once, after the hero entity exists and before the first level is generated. */
  newGame(ctx: Ctx, hero: EntityId): void;
  newLevel(ctx: Ctx, level: Level): void;
}

export type HookName = keyof Hooks;

export interface HookOptions {
  /** Higher runs first. Default 0. */
  priority?: number;
}

export interface ModApi {
  defineTerrain(d: TerrainDef): void;
  defineRole(d: RoleDef): void;
  defineAction(d: ActionDef): void;
  defineTimer(d: TimerDef): void;
  defineMonster(d: MonsterDef): void;
  defineBrain(d: BrainDef): void;
  on<K extends HookName>(hook: K, fn: Hooks[K], opts?: HookOptions): void;
}

export interface Mod {
  id: string;
  version: string;
  dependsOn?: string[];
  register(api: ModApi): void;
}

export interface RegisteredHook<K extends HookName = HookName> {
  mod: string;
  priority: number;
  fn: Hooks[K];
}

/** Read-only view of everything loaded mods registered. Arrays are in deterministic order. */
export interface Registry {
  readonly mods: readonly { id: string; version: string }[];
  terrain(id: DefId): TerrainDef;
  hasTerrain(id: DefId): boolean;
  role(id: DefId): RoleDef;
  timer(id: DefId): TimerDef;
  hasTimer(id: DefId): boolean;
  monster(id: DefId): MonsterDef;
  isMonster(id: DefId): boolean;
  brain(id: DefId): BrainDef;
  /** In registration order. */
  readonly monsters: readonly MonsterDef[];
  readonly roles: readonly RoleDef[];
  readonly terrains: readonly TerrainDef[];
  /** In registration order. */
  readonly actions: readonly (ActionDef & { mod: string })[];
  /** Sorted: priority desc, then mod load order, then registration order. */
  hooks<K extends HookName>(name: K): readonly RegisteredHook<K>[];
}
