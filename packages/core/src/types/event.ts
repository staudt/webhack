import type { DefId, EntityId, Json, Params, Pos } from './common';

export type GameEvent =
  | { type: 'msg'; key: string; params?: Params }
  | { type: 'moved'; id: EntityId; from: Pos; to: Pos }
  | { type: 'doorOpened'; pos: Pos }
  | { type: 'blocked'; pos: Pos; terrain: DefId }
  | { type: 'turnEnded'; turn: number }
  | { type: 'searched' }
  | { type: 'mod'; mod: string; name: string; data: Json };
