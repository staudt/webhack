import type { PlayerAction } from './action';
import type { DefId, Glyph } from './common';
import type { GameEvent } from './event';

export type UiCommand = { type: 'action'; action: PlayerAction } | { type: 'ui'; id: string };

export interface MenuItem {
  id: string;
  labelKey: string;
  run(): void;
}

export interface ClientApi {
  /** `key` is a KeyboardEvent.key or KeyboardEvent.code value. */
  bindKey(key: string, cmd: UiCommand): void;
  addMessages(locale: string, catalog: Record<string, string>): void;
  setGlyph(id: DefId, glyph: Glyph): void;
  onEvent(fn: (e: GameEvent) => void): void;
  addMenuItem(item: MenuItem): void;
}

/** Runs in the UI; presentation, input and menus only. Never saved. */
export interface ClientMod {
  id: string;
  version: string;
  register(api: ClientApi): void;
}
