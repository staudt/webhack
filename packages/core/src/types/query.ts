import type { DefId, EntityId, Msg, Params, Pos } from './common';
import type { PlayerAction } from './action';

export type Target =
  | { kind: 'self' }
  | { kind: 'cell'; pos: Pos }
  | { kind: 'entity'; id: EntityId }
  /** An object in the hero's inventory; offers for any other item are empty. */
  | { kind: 'item'; id: EntityId };

export interface ActionOffer {
  action: PlayerAction;
  labelKey: string;
  params?: Params;
  /** Id of the mod that offered it. */
  source: string;
}

export interface Description {
  terrain: DefId | null;
  remembered: boolean;
  visible: boolean;
  /** Creatures on the cell (visible cells only). */
  entities: { id: EntityId; def: DefId }[];
  /** Objects on the cell, top of the pile first, as shown ids (appearances); visible cells only. */
  objects: { id: EntityId; def: DefId; name: Msg }[];
}

/** Read-only queries, answered from player knowledge only. */
export interface CoreQuery {
  describe(pos: Pos): Description;
  actionsFor(target: Target): ActionOffer[];
  /** A* over remembered passable cells, 8-dir. Excludes the start; null if unreachable. */
  pathTo(pos: Pos): Pos[] | null;
}

/** CoreQuery as seen across the worker boundary. */
export type AsyncCoreQuery = {
  [K in keyof CoreQuery]: (...args: Parameters<CoreQuery[K]>) => Promise<ReturnType<CoreQuery[K]>>;
};
