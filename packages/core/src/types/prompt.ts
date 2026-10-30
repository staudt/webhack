import type { DefId, Json, Params } from './common';

/** A question the core asks the player; answered with a `{ type: 'answer' }` action. */
export interface Prompt {
  id: string;
  kind: 'yn' | 'direction' | 'menu';
  key: string;
  params?: Params;
  options?: PromptOption[];
  /** Menu prompts only: the player may choose several options; the answer is the array of chosen values. */
  multi?: boolean;
}

export interface PromptOption {
  value: Json;
  key: string;
  params?: Params;
  /** Shown glyph id (an item's appearance), for menus of objects. */
  glyph?: DefId;
}
