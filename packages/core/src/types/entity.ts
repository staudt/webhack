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

/** All components are plain data. Reserved for milestone 3: inventory, item. */
export interface Components {
  pos?: PosComponent;
  actor?: ActorComponent;
  player?: PlayerComponent;
  hp?: HpComponent;
  attributes?: AttributesComponent;
  experience?: ExperienceComponent;
  gear?: GearComponent;
  monster?: MonsterComponent;
}

export interface Entity {
  id: EntityId;
  def: DefId;
  c: Components;
}
