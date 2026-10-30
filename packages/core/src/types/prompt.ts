import type { Json, Params } from './common';

/** A question the core asks the player; answered with a `{ type: 'answer' }` action. */
export interface Prompt {
  id: string;
  kind: 'yn' | 'direction' | 'menu';
  key: string;
  params?: Params;
  options?: { value: Json; key: string }[];
}
