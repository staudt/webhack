import type { ClientMod } from '@nh/core';

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
