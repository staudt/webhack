import type { DefId, EntityId, Json, Msg, Params, Pos } from './common';

export type GameEvent =
  | { type: 'msg'; key: string; params?: Params }
  | { type: 'moved'; id: EntityId; from: Pos; to: Pos }
  | { type: 'doorOpened'; pos: Pos }
  | { type: 'blocked'; pos: Pos; terrain: DefId }
  | { type: 'turnEnded'; turn: number }
  | { type: 'searched' }
  /** An informational list for the player (discoveries); the UI shows it in a sheet. */
  | { type: 'list'; titleKey: string; items: Msg[] }
  | { type: 'mod'; mod: string; name: string; data: Json };
