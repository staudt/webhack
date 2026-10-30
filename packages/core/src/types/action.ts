import type { DefId, Json } from './common';

export type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type PlayerAction =
  | { type: 'move'; dir: Dir }
  | { type: 'wait' }
  | { type: 'search' }
  | { type: 'answer'; promptId: string; value: Json }
  | { type: 'mod'; action: DefId; args?: Json };

export type ActionType = PlayerAction['type'];
