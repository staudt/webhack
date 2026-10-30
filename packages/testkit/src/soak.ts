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
  /** The bot stops descending below this dungeon depth. Default: unlimited. */
  maxDepth?: number;
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
  /** Greatest dungeon depth the hero reached. */
  deepestLevel: number;
  /** Monsters the hero killed or destroyed (counted from 'combat.you_kill'/'combat.you_destroy' messages). */
  kills: number;
  /** The actions taken, so a failure can be replayed. */
  log: PlayerAction[];
  /** How the run ended: still playing at the turn limit, or the game ended. */
  outcome: 'playing' | 'died' | 'escaped';
}

const NEIGHBOURS = [-1, 0, 1]
  .flatMap((dy) => [-1, 0, 1].map((dx) => ({ dx, dy })))
  .filter((d) => d.dx || d.dy);

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
  let kills = 0;
  let deepest = 1;
  const depthNow = (): number => state.levels[state.currentLevel]?.depth ?? 1;
  const stepAndTrack = (a: PlayerAction): void => {
    for (const e of engine.step(state, a).events) {
      if (e.type === 'msg' && (e.key === 'combat.you_kill' || e.key === 'combat.you_destroy'))
        kills++;
    }
    deepest = Math.max(deepest, depthNow());
  };
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
      stepAndTrack(answer);
      continue;
    }
    const q = engine.query(state);
    const pos = getPlayer(state).c.pos;
    if (!pos) throw new Error('player has no pos');
    const offers = [...q.actionsFor({ kind: 'self' })];
    for (const { dx, dy } of NEIGHBOURS) {
      offers.push(...q.actionsFor({ kind: 'cell', pos: { x: pos.x + dx, y: pos.y + dy } }));
    }
    const capped = depthNow() >= (opts.maxDepth ?? Infinity);
    if (capped) {
      for (let i = offers.length - 1; i >= 0; i--) {
        const o = offers[i]?.action;
        if (o?.type === 'mod' && o.action === 'nh:down') offers.splice(i, 1);
      }
    }
    if (offers.length === 0) throw new Error('soak: actionsFor offered nothing');
    // Prefer descending 1 time in 4 when standing on a down staircase, so runs visit several levels.
    const descend = offers.find((o) => o.action.type === 'mod' && o.action.action === 'nh:down');
    const wantDown =
      descend !== undefined && depthNow() < (opts.maxDepth ?? Infinity) && rng.rn2(4) === 0;
    const action =
      wantDown && descend
        ? descend.action
        : (offers[rng.rn2(offers.length)] as (typeof offers)[number]).action;
    log.push(action);
    stepAndTrack(action);
    if (log.length % every === 0) check(action);
  }
  if (!violations) check(log[log.length - 1] ?? null);

  const mem = state.memory[state.currentLevel] ?? [];
  const result: SoakResult = {
    actions: log.length,
    finalHash: stateHash(state),
    turns: state.turn,
    violations,
    deepestLevel: deepest,
    kills,
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
