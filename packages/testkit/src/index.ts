export const TESTKIT_VERSION = 1;

export { createScenario, runScenario, DEFAULT_LEGEND } from './scenario';
export type {
  AsciiLegend,
  ScenarioBuilder,
  ScenarioFn,
  ScenarioOptions,
  ScenarioResult,
} from './scenario';
export { runReplay, recordGame } from './replay';
export type { ReplayResult } from './replay';
export { checkInvariants } from './invariants';
export { soak } from './soak';
export type { SoakOptions, SoakResult, SoakViolation } from './soak';
