export type EntityId = number;
export type LevelId = string;
/** Namespaced definition id, e.g. `nh:floor`. */
export type DefId = `${string}:${string}`;

export interface Pos {
  x: number;
  y: number;
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Params = Record<string, string | number>;

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
