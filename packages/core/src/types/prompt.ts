import type { DefId, Json, Params } from './common';

/** A question the core asks the player; answered with a `{ type: 'answer' }` action. */
export interface Prompt {
  id: string;
  /** 'text' is answered with a string (at most `maxLength` characters), or null to cancel. */
  kind: 'yn' | 'direction' | 'menu' | 'text';
  key: string;
  params?: Params;
  options?: PromptOption[];
  /**
   * Menu prompts only: the player may choose several options; the answer is the array of chosen
   * values, where an option with `max` may instead be answered as `{ value, count }`.
   */
  multi?: boolean;
  /** Text prompts: the longest answer accepted. */
  maxLength?: number;
}

export interface PromptOption {
  value: Json;
  key: string;
  params?: Params;
  /** Shown glyph id (an item's appearance), for menus of objects. */
  glyph?: DefId;
  /** Multi menus: a count from 1 to `max` may be chosen for this option (a stack size). */
  max?: number;
}
