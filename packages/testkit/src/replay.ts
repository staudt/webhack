import {
  createEngine,
  stateHash,
  type GameEvent,
  type GameState,
  type Mod,
  type PlayerAction,
  type Replay,
} from '@nh/core';

export interface ReplayResult {
  state: GameState;
  hash: string;
  events: GameEvent[];
}

/** Re-run a recorded game from its seed and actions. Throws if the replay's mods differ from `mods`. */
export function runReplay(mods: readonly Mod[], replay: Replay): ReplayResult {
  const engine = createEngine(mods);
  const have = engine.registry.mods.map((m) => `${m.id}@${m.version}`);
  const want = replay.mods.map((m) => `${m.id}@${m.version}`);
  if (have.join(',') !== want.join(',')) {
    throw new Error(`Replay mod mismatch: replay has [${want.join(', ')}], engine has [${have.join(', ')}]`);
  }
  const first = engine.newGame({ seed: replay.seed, width: replay.width, height: replay.height });
  const state = first.state;
  const events: GameEvent[] = [...first.events];
  for (const action of replay.actions) events.push(...engine.step(state, action).events);
  return { state, hash: stateHash(state), events };
}

/** Play `actions` from a fresh game and return the replay (plus the final hash). */
export function recordGame(
  mods: readonly Mod[],
  opts: { seed: number; width: number; height: number },
  actions: readonly PlayerAction[],
): Replay & { hash: string } {
  const engine = createEngine(mods);
  const { state } = engine.newGame(opts);
  const mine: PlayerAction[] = [];
  for (const a of actions) {
    engine.step(state, a);
    mine.push(JSON.parse(JSON.stringify(a)) as PlayerAction);
  }
  return {
    seed: state.seed,
    width: opts.width,
    height: opts.height,
    mods: state.mods.map((m) => ({ ...m })),
    actions: mine,
    hash: stateHash(state),
  };
}
