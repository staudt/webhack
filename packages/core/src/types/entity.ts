import type { DefId, EntityId, LevelId, Pos } from './common';

/** Movement points per normal-speed action. ref: include/permonst.h NORMAL_SPEED */
export const NORMAL_SPEED = 12;

export interface PosComponent {
  level: LevelId;
  x: number;
  y: number;
}

export interface ActorComponent {
  energy: number;
  speed: number;
}

export interface PlayerComponent {
  role: DefId;
}

export interface HpComponent {
  cur: number;
  max: number;
}

/** NetHack encoding: 3..25, with strength 18/xx stored as 19..118 (ref: include/attrib.h STR18). */
export interface AttributesComponent {
  str: number;
  int: number;
  wis: number;
  dex: number;
  con: number;
  cha: number;
}

export interface ExperienceComponent {
  level: number;
  points: number;
}

/** Dice as [count, sides]. */
export type Dice = [n: number, d: number];

/** Milestone 2 stand-in for worn and wielded items (replaced by real objects in M3). */
export interface GearComponent {
  ac: number;
  weapon: {
    nameKey: string;
    small: Dice;
    large: Dice;
    enchant: number;
    /** Weapon-skill to-hit bonus (ref: src/weapon.c weapon_hit_bonus). */
    skillBonus: number;
  } | null;
}

export interface MonsterComponent {
  level: number;
  peaceful: boolean;
  asleep: boolean;
  /** Where the monster last saw the hero, for tracking. */
  lastHero: Pos | null;
}

/** ref: include/objclass.h enum obj_armor_types */
export type ArmorSlot = 'body' | 'cloak' | 'shirt' | 'helm' | 'gloves' | 'boots' | 'shield';

export type EquipSlot = 'weapon' | ArmorSlot;

export type Buc = 'blessed' | 'uncursed' | 'cursed';

/**
 * An object instance (ref: include/obj.h struct obj). An item is in exactly one place: on the
 * floor (`pos` set, `carriedBy` null) or carried (`carriedBy` set, no `pos`).
 */
export interface ItemComponent {
  quantity: number;
  buc: Buc;
  /** Enchantment or charges (obj->spe). */
  spe: number;
  /** What the hero knows about this instance (obj->bknown, obj->known). */
  known: { buc: boolean; spe: boolean };
  carriedBy: EntityId | null;
  /** Inventory letter; hero's items only. */
  letter: string | null;
  equipped: EquipSlot | null;
  /** Placement sequence (from `state.seq`); the highest on a cell is the top of the pile. */
  placed: number;
  /** Corpses: the monster it was (obj->corpsenm). */
  corpseOf?: DefId;
  /** Turn the object was created (obj->age), for rotting. */
  age?: number;
  /** Nutrition left in partly eaten food (obj->oeaten). */
  eaten?: number;
}

/** ref: src/eat.c hunger states (u.uhs) */
export type HungerState =
  | 'satiated'
  | 'not_hungry'
  | 'hungry'
  | 'weak'
  | 'fainting'
  | 'fainted'
  | 'starved';

export interface HungerComponent {
  /** u.uhunger */
  nutrition: number;
  state: HungerState;
}

/** The entity cannot act until `until` (ref: src/hack.c nomul() with negative multi). */
export interface HelplessComponent {
  until: number;
  /** Message key describing why (multi_reason). */
  reasonKey: string;
}

/** All components are plain data. */
export interface Components {
  pos?: PosComponent;
  actor?: ActorComponent;
  player?: PlayerComponent;
  hp?: HpComponent;
  attributes?: AttributesComponent;
  experience?: ExperienceComponent;
  gear?: GearComponent;
  monster?: MonsterComponent;
  item?: ItemComponent;
  hunger?: HungerComponent;
  helpless?: HelplessComponent;
}

export interface Entity {
  id: EntityId;
  def: DefId;
  c: Components;
}
