import type { Mod } from '@nh/core';
import { ACTIONS } from './actions';
import { BRAINS } from './brains';
import { MONSTERS } from './monsters';
import { OBJECTS, APPEARANCES } from './objects';
import { registerShuffle } from './o_init';
import { nameItem } from './objnam';
import { registerProps } from './props';
import { registerStats } from './stats';
import { ITEM_ACTIONS } from './itemactions';
import { registerNomul } from './nomul';
import { EAT_ACTIONS, registerEat } from './eat';
import { registerHunger } from './hunger';
import { registerCorpses } from './corpses';
import { registerHero } from './hero';
import { ROLES } from './roles';
import { TERRAIN } from './terrain';
import { TRAVEL_ACTIONS } from './travel';
import { RUN_ACTIONS } from './run';
import { registerGeneration } from './generation';
import { registerMklev } from './mklev';
import { POTION_ACTIONS, POTION_USES } from './potion';
import { READ_ACTIONS, SCROLL_USES } from './read';
import { THROW_ACTIONS } from './dothrow';

/** Potion and scroll effects, attached to the object defs (ObjectDef.use). */
const USES = { ...POTION_USES, ...SCROLL_USES };

export const CONTENT_VERSION = 1;

export const vanillaMod: Mod = {
  id: 'nh',
  version: '0.1.0',
  register(api) {
    for (const t of TERRAIN) api.defineTerrain(t);
    for (const r of ROLES) api.defineRole(r);
    for (const a of ACTIONS) api.defineAction(a);
    for (const a of TRAVEL_ACTIONS) api.defineAction(a);
    for (const a of RUN_ACTIONS) api.defineAction(a);
    for (const a of ITEM_ACTIONS) api.defineAction(a);
    for (const a of POTION_ACTIONS) api.defineAction(a);
    for (const a of READ_ACTIONS) api.defineAction(a);
    for (const a of THROW_ACTIONS) api.defineAction(a);
    registerNomul(api);
    registerProps(api);
    for (const a of EAT_ACTIONS) api.defineAction(a);
    registerCorpses(api);
    registerHunger(api);
    registerEat(api);
    for (const b of BRAINS) api.defineBrain(b);
    for (const m of MONSTERS) api.defineMonster(m);
    for (const o of OBJECTS) {
      const use = USES[o.id];
      api.defineObject(use ? { ...o, use } : o);
    }
    for (const a of APPEARANCES) api.defineAppearance(a);
    api.setItemNamer(nameItem);
    registerStats(api);
    registerShuffle(api);
    registerHero(api);
    registerGeneration(api);
    registerMklev(api);
  },
};

export { TERRAIN, T } from './terrain';
export { ACTIONS } from './actions';
export { TRAVEL_ACTIONS } from './travel';
export { RUN_ACTIONS, RUN_MODES } from './run';
export type { RunMode } from './run';
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
export { experienceFor, gainExperience, newuexp, newhp, MAXULEV } from './hero';
export { messagesEn } from './messages.en';
export { ITEM_ACTIONS, lookHere, encumberMsg } from './itemactions';
export { nomul } from './nomul';
export {
  P,
  hasProp,
  heroHas,
  hasIntrinsic,
  timeoutLeft,
  setIntrinsic,
  setItimeout,
  incrItimeout,
  makeStunned,
  adjabil,
} from './props';
export { poisoned, adjattrib } from './attrib';
export { mdamageu, hitmuAd, magicNegation } from './mhitu';
export { passive } from './uhitm_passive';
export { ustuck, setUstuck } from './hackmove';
export { givit, shouldGivit, corpseIntrinsic, cpostfxOf } from './givit';
export { giveStartingKit, VALKYRIE_KIT } from './kit';
export {
  skillInit,
  skillLevel,
  weaponHitBonus,
  weaponDamBonus,
  SKILL_V,
  P_RESTRICTED,
  P_UNSKILLED,
  P_BASIC,
  P_SKILLED,
  P_EXPERT,
  BARE_HANDED,
} from './skills';
export { xnameOf } from './objnam';
export { hitval } from './combat';
export { nhData } from './items';
export { rndmonst, makemon, registerGeneration } from './generation';
export { mcalcmove, clearPath, disturb, dochug, mfndpos } from './monmove';
export { OBJECTS, APPEARANCES } from './objects';
export {
  rne,
  mksobj,
  mkcorpse,
  mkgold,
  weight,
  mergable,
  merged,
  assigninvlet,
  invCount,
  addToInventory,
  removeFromInventory,
  placeOnFloor,
  splitStack,
  bcsign,
  NOINVSYM,
} from './items';
export type { ItemCtx, MksobjOpts } from './items';
export { shuffleAll, discover, isKnown } from './o_init';
export { doname, nameItem } from './objnam';
export {
  findAc,
  findMac,
  moneyCount,
  acurrstr,
  weightCap,
  invWeight,
  calcCapacity,
  nearCapacity,
  heroMovement,
  ENCUMBRANCE_NAMES,
} from './stats';
export { healup, cureSick, POTION_ACTIONS } from './potion';
export { READ_ACTIONS } from './read';
export { THROW_ACTIONS } from './dothrow';
export {
  gethungry,
  newuhs,
  lesshungry,
  morehungry,
  makeSick,
  makeVomiting,
  vomit,
  isSick,
  hungerData,
} from './hunger';
export { EAT_ACTIONS, stopOccupation, losehp } from './eat';
export { mkobj, mkobjAt, rndmonnum, MKOBJ_PROBS } from './mkobj';
export { fillOrdinaryRoom, somexyspace } from './mklev';
export { monsterDied } from './mondeath';
export {
  mongets,
  mInitWeap,
  mInitInv,
  mDoWear,
  selectHwep,
  monWieldItem,
  monWep,
  minvent,
  mpickstuff,
  relobj,
} from './mongear';
export { xkilledCorpse, corpseChance, startCorpseTimeout, rnz, ROT_AGE } from './corpses';
