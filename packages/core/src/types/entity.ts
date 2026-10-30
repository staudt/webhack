import type { DefId, EntityId, LevelId } from './common';

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

/** All components are plain data. Reserved for milestone 2: hp, monster, inventory, item. */
export interface Components {
  pos?: PosComponent;
  actor?: ActorComponent;
  player?: PlayerComponent;
}

export interface Entity {
  id: EntityId;
  def: DefId;
  c: Components;
}
