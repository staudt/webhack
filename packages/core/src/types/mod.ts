import type { ActionType, PlayerAction } from './action';
import type { DefId, EntityId, Glyph, Json, Msg } from './common';
import type { ArmorSlot, Dice, Entity } from './entity';
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
  /** Movement gained at the end of each turn (ref: src/allmain.c u_calc_moveamt); defaults to speed. */
  movement?(ctx: Ctx, hero: EntityId): number;
}

/** ref: include/objclass.h enum obj_class_types (the classes implemented so far). */
export type ObjectClass = 'weapon' | 'armor' | 'food' | 'potion' | 'scroll' | 'coin';

/** An object type, ported from struct objclass (ref: include/objclass.h, include/objects.h). */
export interface ObjectDef {
  id: DefId;
  /** The actual name ("potion of healing"). */
  nameKey: string;
  class: ObjectClass;
  glyph: Glyph;
  /** Fixed unidentified description ("crude dagger"); classes with shuffled appearances leave it out. */
  descKey?: string;
  /** Generation probability within its class (oc_prob). */
  prob: number;
  /** oc_weight */
  weight: number;
  /** oc_cost */
  cost: number;
  /** One of NetHack's materials, lowercased ('iron', 'wood', 'cloth', 'glass', ...). */
  material: string;
  /** oc_merge: equal instances stack. */
  merge: boolean;
  /** oc_magic */
  magic: boolean;
  /** oc_delay: turns to put on/take off armor, or to eat. */
  delay: number;
  weapon?: {
    small: Dice;
    large: Dice;
    /** oc_hitbon */
    hitBonus: number;
    /** Weapon skill name, e.g. 'dagger', 'spear'. */
    skill: string;
    bimanual: boolean;
    kind: 'pierce' | 'slash' | 'whack';
  };
  armor?: { slot: ArmorSlot; ac: number; mc: number };
  food?: { nutrition: number };
  /** Effect when quaffed or read; called by content's actions. */
  use?(ctx: Ctx, user: EntityId, item: EntityId): void;
}

/** A randomized description ("ruby potion") with its glyph; assigned per game via `state.appearances`. */
export interface AppearanceDef {
  id: DefId;
  nameKey: string;
  class: ObjectClass;
  glyph: Glyph;
}

/** A bottom-line field computed from state (AC, gold, hunger); null leaves it out. ref: src/botl.c */
export interface StatusDef {
  id: DefId;
  /** Key in `ViewSnapshot.status`; a def may replace a built-in field. */
  field: string;
  value(state: Readonly<GameState>, defs: Registry): string | number | null;
}

/** Names an item for the player, from player knowledge only (ref: src/objnam.c doname). */
export type ItemNamer = (state: Readonly<GameState>, defs: Registry, item: Entity) => Msg;

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
   * Multi-turn actions (travel, running, eating). After a move that took time and wasn't
   * interrupted, returning true keeps `state.occupation` set, so the next
   * `{ type: 'continue' }` performs the action again. Per-action progress belongs in
   * `state.occupation.data` (null on the first move), never in module variables.
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
  /** Corpse weight (cwt). */
  weight: number;
  /** Corpse nutrition (cnutrit). */
  nutrition: number;
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
  defineObject(d: ObjectDef): void;
  defineAppearance(d: AppearanceDef): void;
  defineStatus(d: StatusDef): void;
  /** Replaces the item namer; the last mod to set it wins. */
  setItemNamer(fn: ItemNamer): void;
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
  object(id: DefId): ObjectDef;
  isObject(id: DefId): boolean;
  appearance(id: DefId): AppearanceDef;
  isAppearance(id: DefId): boolean;
  /** Names an item with the active namer (a default one if no mod set it). */
  itemName(state: Readonly<GameState>, item: Entity): Msg;
  /** In registration order. */
  readonly monsters: readonly MonsterDef[];
  /** In registration order. */
  readonly objects: readonly ObjectDef[];
  /** In registration order. */
  readonly appearances: readonly AppearanceDef[];
  /** In registration order (later defs win for the same field). */
  readonly statuses: readonly StatusDef[];
  readonly roles: readonly RoleDef[];
  readonly terrains: readonly TerrainDef[];
  /** In registration order. */
  readonly actions: readonly (ActionDef & { mod: string })[];
  /** Sorted: priority desc, then mod load order, then registration order. */
  hooks<K extends HookName>(name: K): readonly RegisteredHook<K>[];
}
