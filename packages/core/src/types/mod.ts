import type { ActionType, PlayerAction } from './action';
import type { DefId, Glyph } from './common';
import type { GameEvent } from './event';
import type { Level } from './level';
import type { ActionOffer, CoreQuery, Target } from './query';
import type { Rng } from './rng';
import type { GameState } from './state';

export interface TerrainDef {
  id: DefId;
  nameKey: string;
  passable: boolean;
  opaque: boolean;
  door?: 'closed' | 'open' | 'doorway';
  stairs?: 'up' | 'down';
  glyph: Glyph;
}

export interface RoleDef {
  id: DefId;
  nameKey: string;
  speed: number;
  /** The player's map glyph; the player entity's `def` is the role id. */
  glyph: Glyph;
}

export interface ActionDef {
  id: DefId;
  labelKey: string;
  /** Which PlayerAction type this def performs. Built-ins use their own type; mod actions use 'mod' and match on `action.action === id`. */
  handles: ActionType;
  /** Offers this action contributes to `actionsFor(target)`. */
  offer(ctx: Ctx, target: Target): ActionOffer[];
  /** Performs the action; returns the energy cost (0 = no time passes). */
  perform(ctx: Ctx, action: PlayerAction): number;
}

export interface Ctx {
  readonly state: GameState;
  rng: Rng;
  cosmetic: Rng;
  defs: Registry;
  emit(e: GameEvent): void;
  query: CoreQuery;
}

export interface Hooks {
  beforeAction(ctx: Ctx, a: PlayerAction): 'continue' | 'cancel';
  afterAction(ctx: Ctx, a: PlayerAction): void;
  endOfTurn(ctx: Ctx): void;
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
  readonly roles: readonly RoleDef[];
  readonly terrains: readonly TerrainDef[];
  /** In registration order. */
  readonly actions: readonly (ActionDef & { mod: string })[];
  /** Sorted: priority desc, then mod load order, then registration order. */
  hooks<K extends HookName>(name: K): readonly RegisteredHook<K>[];
}
