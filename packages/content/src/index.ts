import type { Mod } from '@nh/core';
import { ACTIONS } from './actions';
import { BRAINS } from './brains';
import { MONSTERS } from './monsters';
import { registerHero } from './hero';
import { ROLES } from './roles';
import { TERRAIN } from './terrain';
import { TRAVEL_ACTIONS } from './travel';
import { registerGeneration } from './generation';

export const CONTENT_VERSION = 1;

export const vanillaMod: Mod = {
  id: 'nh',
  version: '0.1.0',
  register(api) {
    for (const t of TERRAIN) api.defineTerrain(t);
    for (const r of ROLES) api.defineRole(r);
    for (const a of ACTIONS) api.defineAction(a);
    for (const a of TRAVEL_ACTIONS) api.defineAction(a);
    for (const b of BRAINS) api.defineBrain(b);
    for (const m of MONSTERS) api.defineMonster(m);
    registerHero(api);
    registerGeneration(api);
  },
};

export { TERRAIN, T } from './terrain';
export { ACTIONS } from './actions';
export { TRAVEL_ACTIONS } from './travel';
export { ROLES } from './roles';
export { MONSTERS } from './monsters';
export { BRAINS } from './brains';
export {
  heroAttack,
  monsterAttack,
  heroToHit,
  monsterToHit,
  dmgval,
  abon,
  dbon,
  acValue,
} from './combat';
export {
  experienceFor,
  gainExperience,
  newuexp,
  newhp,
  MAXULEV,
  VALKYRIE_STARTING_GEAR,
} from './hero';
export { messagesEn } from './messages.en';
export { rndmonst, makemon, registerGeneration } from './generation';
export { mcalcmove, clearPath, disturb, dochug, mfndpos } from './monmove';
