export type EntityId = number;
export type LevelId = string;
/** Namespaced definition id, e.g. `nh:floor`. */
export type DefId = `${string}:${string}`;

export interface Pos {
  x: number;
  y: number;
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** A message: a catalog key plus params. Params may nest messages (item names inside sentences). */
export interface Msg {
  key: string;
  params?: Params;
}

export type Params = { [k: string]: string | number | Msg };

/** sfc32 state: four uint32 words. */
export type RngState = [number, number, number, number];

export interface ModRef {
  id: string;
  version: string;
}

export interface Glyph {
  ch: string;
  fg: string;
}
