export const CORE_VERSION = 1;

export * from './types/index';
export { loadMods, requireTerrains, ModLoadError } from './registry';
export type { ModLoadIssue } from './registry';
export { seedRng, newRngStates, createRng } from './rng';
export { canonicalJson, stateHash, isJsonPlain } from './hash';
export { sortedIds, cellIndex, inBounds, DIRS, DIR_LIST } from './util';
export { cellRules, checkStep } from './movement';
export type { CellRules, StepCheck } from './movement';
export { computeVisible, updateMemory, newMemory } from './vision';
export { findPath } from './path';
