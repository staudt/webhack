import type { Mod } from '@nh/core';
import { ACTIONS } from './actions';
import { ROLES } from './roles';
import { TERRAIN } from './terrain';

export const CONTENT_VERSION = 1;

export const vanillaMod: Mod = {
  id: 'nh',
  version: '0.1.0',
  register(api) {
    for (const t of TERRAIN) api.defineTerrain(t);
    for (const r of ROLES) api.defineRole(r);
    for (const a of ACTIONS) api.defineAction(a);
  },
};

export { TERRAIN, T } from './terrain';
export { ACTIONS } from './actions';
export { ROLES } from './roles';
export { messagesEn } from './messages.en';
