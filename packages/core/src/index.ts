export const CORE_VERSION = 1;

export * from './types/index';
export { loadMods, requireTerrains, ModLoadError } from './registry';
export type { ModLoadIssue } from './registry';
export { seedRng, newRngStates, createRng, rnl } from './rng';
export { canonicalJson, stateHash, isJsonPlain } from './hash';
export { sortedIds, cellIndex, inBounds, DIRS, DIR_LIST } from './util';
export { cellRules, checkStep } from './movement';
export type { CellRules, StepCheck } from './movement';
export { computeVisible, updateMemory, newMemory } from './vision';
export { findPath } from './path';
export {
  generateLevel,
  levelToAscii,
  VANILLA_TERRAIN,
  MIN_LEVEL_WIDTH,
  MIN_LEVEL_HEIGHT,
} from './levelgen/index';
export type { GenOptions, LevelTerrain } from './levelgen/index';
export { createEngine, UnknownActionError, DEFAULT_WIDTH, DEFAULT_HEIGHT } from './engine';
export type { Engine, EngineOptions, NewGameOptions } from './engine';
export { createQuery } from './query';
export { serializeSave, parseSave, SAVE_FORMAT, SAVE_VERSION } from './save';
export { getPlayer, getLevel, playerPos, isVisible } from './state';
export { buildSnapshot, diffSnapshot, applyUpdate } from './view';
export { createHost } from './host';
export type { Host } from './host';
