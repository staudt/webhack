import type { Mod } from '@nh/core';
import { ACTIONS } from './actions';
import { BRAINS } from './brains';
import { MONSTERS } from './monsters';
import { registerHero } from './hero';
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
    for (const b of BRAINS) api.defineBrain(b);
    for (const m of MONSTERS) api.defineMonster(m);
    registerHero(api);
  },
};

export { TERRAIN, T } from './terrain';
export { ACTIONS } from './actions';
export { ROLES } from './roles';
export { MONSTERS } from './monsters';
export { BRAINS } from './brains';
export { experienceFor, gainExperience, newuexp, newhp, MAXULEV, VALKYRIE_STARTING_GEAR } from './hero';
export { messagesEn } from './messages.en';
