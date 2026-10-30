import type { ClientMod, Dir, UiCommand } from '@nh/core';

export interface KeyLike {
  code: string;
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
}

export class Keymap {
  private readonly map = new Map<string, UiCommand>();

  bind(key: string, cmd: UiCommand): void {
    this.map.set(key, cmd);
  }

  /**
   * Lookup by `code` first, then by `key`. With Shift held, `Shift+<code>` and `Shift+<key>`
   * bindings are tried first, so Shift+arrow can differ from the plain arrow.
   */
  resolve(e: KeyLike): UiCommand | undefined {
    // Ctrl chords only match explicit `Ctrl+<key>` bindings (bound as e.g. 'Ctrl+d').
    if (e.ctrlKey) return this.map.get(`Ctrl+${e.key.toLowerCase()}`);
    if (e.shiftKey) {
      const shifted = this.map.get(`Shift+${e.code}`) ?? this.map.get(`Shift+${e.key}`);
      if (shifted) return shifted;
    }
    return this.map.get(e.code) ?? this.map.get(e.key);
  }
}

const move = (dir: Dir): UiCommand => ({ type: 'action', action: { type: 'move', dir } });
const wait: UiCommand = { type: 'action', action: { type: 'wait' } };
const search: UiCommand = { type: 'action', action: { type: 'search' } };

const DIR_KEYS: [string, Dir][] = [
  ['ArrowUp', 'n'],
  ['ArrowDown', 's'],
  ['ArrowLeft', 'w'],
  ['ArrowRight', 'e'],
  ['h', 'w'],
  ['j', 's'],
  ['k', 'n'],
  ['l', 'e'],
  ['y', 'nw'],
  ['u', 'ne'],
  ['b', 'sw'],
  ['n', 'se'],
  ['Numpad7', 'nw'],
  ['Numpad8', 'n'],
  ['Numpad9', 'ne'],
  ['Numpad4', 'w'],
  ['Numpad6', 'e'],
  ['Numpad1', 'sw'],
  ['Numpad2', 's'],
  ['Numpad3', 'se'],
  ['Home', 'nw'],
  ['PageUp', 'ne'],
  ['End', 'sw'],
  ['PageDown', 'se'],
];

export const defaultKeymap: ClientMod = {
  id: 'ui-default-keys',
  version: '1.0.0',
  register(api) {
    for (const [k, d] of DIR_KEYS) api.bindKey(k, move(d));
    for (const k of ['.', 'Numpad5', 'Clear']) api.bindKey(k, wait);
    api.bindKey('s', search);
  },
};
