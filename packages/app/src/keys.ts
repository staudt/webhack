import type { ClientMod, Dir, PlayerAction } from '@nh/core';

/** Item verbs: key -> mod action id; each opens an item picker (host command `pick:<id>`). */
const PICK_KEYS: [string, string][] = [
  ['d', 'nh:drop'],
  ['w', 'nh:wield'],
  ['W', 'nh:wear'],
  ['T', 'nh:takeoff'],
  ['e', 'nh:eat'],
  ['q', 'nh:quaff'],
  ['r', 'nh:read'],
  ['t', 'nh:throw'],
];

/** Vanilla client keys beyond the UI defaults: stairs, inventory and item verbs. */
export const vanillaKeys: ClientMod = {
  id: 'nh-vanilla-keys',
  version: '1.0.0',
  register(api) {
    api.bindKey('>', { type: 'action', action: { type: 'mod', action: 'nh:down' } });
    api.bindKey('<', { type: 'action', action: { type: 'mod', action: 'nh:up' } });
    api.bindKey('i', { type: 'ui', id: 'inventory' });
    api.bindKey(',', { type: 'ui', id: 'self:nh:pickup' });
    api.bindKey('\\', { type: 'ui', id: 'self:nh:discoveries' });
    for (const [k, id] of PICK_KEYS) api.bindKey(k, { type: 'ui', id: `pick:${id}` });
  },
};

/**
 * NetHack 5.0 run modes (ref: src/cmd.c; `context.run`): Shift+direction is mode 1 ('shift'),
 * the `g` prefix is mode 2 ('rush'), the `G` prefix is mode 3 ('run').
 */
export const runAction = (dir: Dir, mode: 'shift' | 'rush' | 'run'): PlayerAction => ({
  type: 'mod',
  action: RUN_ACTION,
  args: { dir, mode },
});

export const RUN_ACTION = 'nh:run';

/** vi keys and arrows, with the direction each one means. */
const RUN_KEYS: [string, Dir][] = [
  ['h', 'w'],
  ['j', 's'],
  ['k', 'n'],
  ['l', 'e'],
  ['y', 'nw'],
  ['u', 'ne'],
  ['b', 'sw'],
  ['n', 'se'],
];
const RUN_ARROWS: [string, Dir][] = [
  ['ArrowUp', 'n'],
  ['ArrowDown', 's'],
  ['ArrowLeft', 'w'],
  ['ArrowRight', 'e'],
];

/** Running: g and G prefixes, Shift+direction. The double-tap gesture is set in `runGestures`. */
export const runKeys: ClientMod = {
  id: 'nh-run-keys',
  version: '1.0.0',
  register(api) {
    api.bindKey('g', { type: 'ui', id: 'prefix:rush' });
    api.bindKey('G', { type: 'ui', id: 'prefix:run' });
    for (const [k, d] of RUN_KEYS)
      api.bindKey(k.toUpperCase(), { type: 'action', action: runAction(d, 'shift') });
    for (const [k, d] of RUN_ARROWS)
      api.bindKey(`Shift+${k}`, { type: 'action', action: runAction(d, 'shift') });
  },
};

/** UI options for the run gestures: double tap and the g/G prefixes. */
export const runGestures = {
  doubleTap: { action: RUN_ACTION },
  prefixes: {
    rush: (dir: Dir) => runAction(dir, 'rush'),
    run: (dir: Dir) => runAction(dir, 'run'),
  },
};
