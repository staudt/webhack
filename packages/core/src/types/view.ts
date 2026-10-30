import type { DefId, EntityId, Glyph, LevelId, Pos } from './common';

export interface ViewCell {
  /** Remembered terrain glyph key, or null if never seen. */
  g: DefId | null;
  /** Visible this turn. */
  v: boolean;
}

export interface ViewEntity {
  id: EntityId;
  g: DefId;
  x: number;
  y: number;
}

export interface ViewPlayer {
  id: EntityId;
  x: number;
  y: number;
}

export type Status = Record<string, string | number>;

export interface ViewSnapshot {
  kind: 'full';
  levelId: LevelId;
  width: number;
  height: number;
  /** Default glyphs from defs; client mods may override. */
  legend: Record<DefId, Glyph>;
  cells: ViewCell[];
  entities: ViewEntity[];
  player: ViewPlayer;
  turn: number;
  status: Status;
}

export interface ViewDelta {
  kind: 'delta';
  turn: number;
  /** Only changed cells. */
  cells: [index: number, cell: ViewCell][];
  /** Full visible list. */
  entities: ViewEntity[];
  player: ViewPlayer;
  status: Status;
}

export type ViewUpdate = ViewSnapshot | ViewDelta;

/** Implemented by renderers. Type-only so DOM-free packages can reference it. */
export interface Renderer {
  mount(el: HTMLElementLike): void;
  apply(v: ViewUpdate): void;
  setGlyph(id: DefId, glyph: Glyph): void;
  cellAt(clientX: number, clientY: number): Pos | null;
  resize(): void;
  destroy(): void;
}

/** Structural stand-in for HTMLElement; core compiles without the DOM lib. */
export type HTMLElementLike = object;
