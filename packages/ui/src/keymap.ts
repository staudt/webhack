import type { ClientMod, Dir, UiCommand } from '@nh/core';

export interface KeyLike {
  code: string;
  key: string;
}

export class Keymap {
  private readonly map = new Map<string, UiCommand>();

  bind(key: string, cmd: UiCommand): void {
    this.map.set(key, cmd);
  }

  /** Lookup by `code` first, then by `key`. */
  resolve(e: KeyLike): UiCommand | undefined {
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
