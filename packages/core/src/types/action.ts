import type { DefId, Json } from './common';

export type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type PlayerAction =
  | { type: 'move'; dir: Dir }
  | { type: 'wait' }
  | { type: 'search' }
  | { type: 'answer'; promptId: string; value: Json }
  /** Performs the next move of the multi-turn action in `state.occupation` (no-op if none). */
  | { type: 'continue' }
  | { type: 'mod'; action: DefId; args?: Json };

export type ActionType = PlayerAction['type'];
