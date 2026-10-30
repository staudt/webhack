import type { PlayerAction } from './action';
import type { Json, ModRef } from './common';
import type { GameEvent } from './event';
import type { Prompt } from './prompt';
import type { CoreQuery } from './query';
import type { ViewUpdate } from './view';
import type { GameState } from './state';

export interface Replay {
  seed: number;
  width: number;
  height: number;
  mods: ModRef[];
  actions: PlayerAction[];
}

export interface SaveFile {
  format: 'nh-ts';
  version: 2;
  mods: ModRef[];
  state: GameState;
  replay: Replay;
}

export type ToCore =
  | { t: 'new'; seed: number; width: number; height: number }
  | { t: 'load'; save: string }
  | { t: 'act'; action: PlayerAction }
  | { t: 'query'; id: number; q: keyof CoreQuery; args: Json[] }
  | { t: 'save' }
  | { t: 'hash' };

export type FromCore =
  | { t: 'view'; view: ViewUpdate; events: GameEvent[]; prompt: Prompt | null }
  | { t: 'reply'; id: number; result: Json }
  | { t: 'saved'; save: string }
  | { t: 'hash'; hash: string }
  | { t: 'error'; message: string };
