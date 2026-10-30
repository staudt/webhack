import { describe, expect, test } from 'vitest';
import type { ClientApi, UiCommand } from '@nh/core';
import { Keymap, defaultKeymap } from '../src/keymap';

function dflt(): Keymap {
  const km = new Keymap();
  defaultKeymap.register({ bindKey: (k, c) => km.bind(k, c) } as ClientApi);
  return km;
}
const act = (c: UiCommand | undefined) => (c?.type === 'action' ? c.action : undefined);
const mv = (km: Keymap, code: string, key = code) => {
  const a = act(km.resolve({ code, key }));
  return a?.type === 'move' ? a.dir : a?.type;
};

describe('keymap', () => {
  test('code before key, later bindings override', () => {
    const km = new Keymap();
    km.bind('KeyA', { type: 'ui', id: 'code' });
    km.bind('a', { type: 'ui', id: 'key' });
    expect(km.resolve({ code: 'KeyA', key: 'a' })).toEqual({ type: 'ui', id: 'code' });
    expect(km.resolve({ code: 'KeyZ', key: 'a' })).toEqual({ type: 'ui', id: 'key' });
    km.bind('a', { type: 'ui', id: 'key2' });
    expect(km.resolve({ code: 'KeyZ', key: 'a' })).toEqual({ type: 'ui', id: 'key2' });
    expect(km.resolve({ code: 'KeyZ', key: 'z' })).toBeUndefined();
  });
  test('default arrows and vi keys', () => {
    const km = dflt();
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((k) => mv(km, k))).toEqual([
      'n',
      's',
      'w',
      'e',
    ]);
    expect(
      ['h', 'j', 'k', 'l', 'y', 'u', 'b', 'n'].map((k) => mv(km, 'Key' + k.toUpperCase(), k)),
    ).toEqual(['w', 's', 'n', 'e', 'nw', 'ne', 'sw', 'se']);
  });
  test('numpad, nav keys, wait, search', () => {
    const km = dflt();
    const pad = [1, 2, 3, 4, 6, 7, 8, 9].map((n) => mv(km, `Numpad${n}`, String(n)));
    expect(pad).toEqual(['sw', 's', 'se', 'w', 'e', 'nw', 'n', 'ne']);
    expect(['Home', 'PageUp', 'End', 'PageDown'].map((k) => mv(km, k))).toEqual([
      'nw',
      'ne',
      'sw',
      'se',
    ]);
    expect(mv(km, 'Numpad5', '5')).toBe('wait');
    expect(mv(km, 'Clear')).toBe('wait');
    expect(mv(km, 'Period', '.')).toBe('wait');
    expect(mv(km, 'KeyS', 's')).toBe('search');
  });
});
