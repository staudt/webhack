import {
  createEngine,
  createRng,
  getPlayer,
  seedRng,
  stateHash,
  type Mod,
  type PlayerAction,
} from '@nh/core';
import { checkInvariants } from './invariants';

export interface SoakOptions {
  seed: number;
  turns: number;
  width?: number;
  height?: number;
  botSeed?: number;
  checkEvery?: number;
  /** Return violations instead of throwing. */
  collect?: boolean;
}

export interface SoakViolation {
  step: number;
  action: PlayerAction | null;
  errors: string[];
}

export interface SoakResult {
  actions: number;
  finalHash: string;
  turns: number;
  violations: SoakViolation | null;
  cellsExplored: number;
  /** The actions taken, so a failure can be replayed. */
  log: PlayerAction[];
  /** How the run ended: still playing at the turn limit, or the game ended. */
  outcome: 'playing' | 'died' | 'escaped';
}

const NEIGHBOURS = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ dx, dy }))).filter((d) => d.dx || d.dy);

/** A seeded random-legal-action bot driven by `actionsFor()`; checks invariants as it goes. */
export function soak(mods: readonly Mod[], opts: SoakOptions): SoakResult {
  const engine = createEngine(mods);
  const { state } = engine.newGame({
    seed: opts.seed,
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
  });
  const rng = createRng(seedRng(opts.botSeed ?? opts.seed ^ 0x5eed));
  const every = Math.max(1, opts.checkEvery ?? 1);
  const maxActions = opts.turns * 20;
  const log: PlayerAction[] = [];
  let violations: SoakViolation | null = null;

  const check = (action: PlayerAction | null): void => {
    const errors = checkInvariants(state, engine.registry);
    if (errors.length > 0) violations = { step: log.length, action, errors };
  };
  check(null);

  while (!violations && !state.gameOver && state.turn < opts.turns && log.length < maxActions) {
    // The bot always declines prompts (e.g. leaving the dungeon) so runs keep going.
    const pending = state.pendingPrompt;
    if (pending) {
      const answer: PlayerAction = { type: 'answer', promptId: pending.prompt.id, value: false };
      log.push(answer);
      engine.step(state, answer);
      continue;
    }
    const q = engine.query(state);
    const pos = getPlayer(state).c.pos;
    if (!pos) throw new Error('player has no pos');
    const offers = [...q.actionsFor({ kind: 'self' })];
    for (const { dx, dy } of NEIGHBOURS) {
      offers.push(...q.actionsFor({ kind: 'cell', pos: { x: pos.x + dx, y: pos.y + dy } }));
    }
    if (offers.length === 0) throw new Error('soak: actionsFor offered nothing');
    const action = (offers[rng.rn2(offers.length)] as (typeof offers)[number]).action;
    log.push(action);
    engine.step(state, action);
    if (log.length % every === 0) check(action);
  }
  if (!violations) check(log[log.length - 1] ?? null);

  const mem = state.memory[state.currentLevel] ?? [];
  const result: SoakResult = {
    actions: log.length,
    finalHash: stateHash(state),
    turns: state.turn,
    violations,
    cellsExplored: mem.filter((m) => m >= 0).length,
    log,
    outcome: state.gameOver?.kind ?? 'playing',
  };
  const v = result.violations as SoakViolation | null;
  if (v && !opts.collect) {
    throw new Error(
      `soak invariant violation at step ${v.step} after ${JSON.stringify(v.action)}:\n  ${v.errors.join('\n  ')}`,
    );
  }
  return result;
}
