import {
  VANILLA_TERRAIN,
  computeVisible,
  cellRules,
  createEngine,
  getLevel,
  getPlayer,
  newMemory,
  updateMemory,
  type CoreQuery,
  type DefId,
  type Engine,
  type GameEvent,
  type GameState,
  type Level,
  type Mod,
  type PlayerAction,
  type Pos,
} from '@nh/core';
import { test } from 'vitest';

/** ASCII char -> terrain def. '@' is reserved: floor plus the player start. */
export type AsciiLegend = Record<string, DefId>;

export const DEFAULT_LEGEND: AsciiLegend = {
  ' ': VANILLA_TERRAIN.stone,
  '|': VANILLA_TERRAIN.vwall,
  '-': VANILLA_TERRAIN.hwall,
  '.': VANILLA_TERRAIN.floor,
  '#': VANILLA_TERRAIN.corr,
  '+': VANILLA_TERRAIN.door_closed,
  '<': VANILLA_TERRAIN.stairs_up,
  '>': VANILLA_TERRAIN.stairs_down,
  D: VANILLA_TERRAIN.doorway,
  v: VANILLA_TERRAIN.door_open_v,
  h: VANILLA_TERRAIN.door_open_h,
  '@': VANILLA_TERRAIN.floor,
};

export interface ScenarioBuilder {
  /** Replace dlvl1 with a hand-built level; '@' marks the player. */
  level(ascii: string | string[], opts?: { lit?: boolean }): void;
  player(pos: Pos): void;
  act(action: PlayerAction | PlayerAction[]): void;
  /** Matches any event from the most recent act() (deep partial match). */
  expectEvent(partial: Partial<GameEvent> & { type: GameEvent['type'] }): void;
  expectNoEvent(type: GameEvent['type']): void;
  expectPos(pos: Pos): void;
  expectTurn(turn: number): void;
  expectTerrain(pos: Pos, id: DefId): void;
  check(fn: (state: GameState, query: CoreQuery) => void): void;
}

export interface ScenarioResult {
  state: GameState;
  engine: Engine;
  events: GameEvent[];
}

export type ScenarioFn = (name: string, build: (s: ScenarioBuilder) => void) => void;
export interface ScenarioOptions {
  legend?: Partial<AsciiLegend>;
}

const SCENARIO_SEED = 1;

function isSubset(want: unknown, have: unknown): boolean {
  if (want === null || typeof want !== 'object') return want === have;
  if (have === null || typeof have !== 'object') return false;
  if (Array.isArray(want)) {
    return Array.isArray(have) && want.length === have.length && want.every((w, i) => isSubset(w, have[i]));
  }
  const h = have as Record<string, unknown>;
  return Object.keys(want).every((k) => isSubset((want as Record<string, unknown>)[k], h[k]));
}

function render(level: Level, legend: AsciiLegend, at: Pos): string {
  const byId = new Map<string, string>();
  for (const ch of Object.keys(legend).sort()) {
    if (ch === '@') continue;
    const id = legend[ch] as string;
    if (!byId.has(id)) byId.set(id, ch);
  }
  const rows: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = '';
    for (let x = 0; x < level.width; x++) {
      if (x === at.x && y === at.y) {
        row += '@';
        continue;
      }
      const id = level.palette[level.cells[y * level.width + x] ?? 0] ?? '';
      row += byId.get(id) ?? '?';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

export function runScenario(
  mods: readonly Mod[],
  build: (s: ScenarioBuilder) => void,
  opts: ScenarioOptions = {},
): ScenarioResult {
  const legend: AsciiLegend = { ...DEFAULT_LEGEND };
  for (const [k, v] of Object.entries(opts.legend ?? {})) if (v !== undefined) legend[k] = v;
  const engine = createEngine(mods);
  const { state } = engine.newGame({ seed: SCENARIO_SEED });
  let events: GameEvent[] = [];
  let step = 0;

  const refresh = (): void => {
    const level = getLevel(state);
    const visible = computeVisible(level, cellRules(level, engine.registry), playerAt());
    const memory = (state.memory[level.id] ??= newMemory(level));
    updateMemory(memory, level, visible);
    state.visible = visible;
  };
  const playerAt = (): Pos => {
    const p = getPlayer(state).c.pos;
    if (!p) throw new Error('player has no pos');
    return { x: p.x, y: p.y };
  };
  const fail = (msg: string): never => {
    const level = getLevel(state);
    throw new Error(
      `Scenario step ${step}: ${msg}\nturn ${state.turn}, player at ${JSON.stringify(playerAt())}\n` +
        `events: ${JSON.stringify(events)}\n${render(level, legend, playerAt())}`,
    );
  };

  const buildLevel = (ascii: string | string[], lit: boolean): void => {
    const rows = typeof ascii === 'string' ? ascii.split('\n') : ascii;
    const width = Math.max(...rows.map((r) => r.length));
    const height = rows.length;
    const palette: DefId[] = [...Object.values(VANILLA_TERRAIN)];
    const cells: number[] = [];
    let start: Pos | null = null;
    let up: Pos | null = null;
    let down: Pos | null = null;
    for (let y = 0; y < height; y++) {
      const row = (rows[y] as string).padEnd(width, ' ');
      for (let x = 0; x < width; x++) {
        const ch = row.charAt(x);
        const id = legend[ch];
        if (id === undefined) throw new Error(`level(): character '${ch}' at ${x},${y} is not in the legend`);
        if (ch === '@') {
          if (start) throw new Error('level(): more than one @');
          start = { x, y };
        }
        if (id === VANILLA_TERRAIN.stairs_up) up = { x, y };
        if (id === VANILLA_TERRAIN.stairs_down) down = { x, y };
        let pi = palette.indexOf(id);
        if (pi === -1) pi = palette.push(id) - 1;
        cells.push(pi);
      }
    }
    const old = getLevel(state);
    const level: Level = {
      id: old.id,
      depth: old.depth,
      width,
      height,
      palette,
      cells,
      lit: cells.map(() => (lit ? 1 : 0)),
      rooms: [],
      up,
      down,
    };
    state.levels[level.id] = level;
    delete state.memory[level.id];
    const pos = getPlayer(state).c.pos;
    const at = start ?? up ?? down;
    if (!pos || !at) throw new Error('level(): mark the player start with @');
    pos.x = at.x;
    pos.y = at.y;
    refresh();
  };

  const s: ScenarioBuilder = {
    level(ascii, o) {
      buildLevel(ascii, o?.lit ?? true);
    },
    player(p) {
      const pos = getPlayer(state).c.pos;
      if (!pos) throw new Error('player has no pos');
      pos.x = p.x;
      pos.y = p.y;
      refresh();
    },
    act(action) {
      events = [];
      for (const a of Array.isArray(action) ? action : [action]) {
        events.push(...engine.step(state, a).events);
      }
    },
    expectEvent(partial) {
      if (!events.some((e) => isSubset(partial, e))) fail(`expected event ${JSON.stringify(partial)} was not emitted`);
    },
    expectNoEvent(type) {
      const e = events.find((x) => x.type === type);
      if (e) fail(`unexpected '${type}' event ${JSON.stringify(e)}`);
    },
    expectPos(p) {
      const a = playerAt();
      if (a.x !== p.x || a.y !== p.y) fail(`expected player at ${JSON.stringify(p)}, found ${JSON.stringify(a)}`);
    },
    expectTurn(t) {
      if (state.turn !== t) fail(`expected turn ${t}, found ${state.turn}`);
    },
    expectTerrain(p, id) {
      const level = getLevel(state);
      const got = level.palette[level.cells[p.y * level.width + p.x] ?? -1];
      if (got !== id) fail(`expected terrain '${id}' at ${JSON.stringify(p)}, found '${got ?? 'out of bounds'}'`);
    },
    check(fn) {
      fn(state, engine.query(state));
    },
  };

  // Record builder calls, then execute them in order.
  const recorded: ((real: ScenarioBuilder) => void)[] = [];
  const recorder = {} as ScenarioBuilder;
  for (const key of Object.keys(s) as (keyof ScenarioBuilder)[]) {
    (recorder as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      recorded.push((real) => (real[key] as (...a: unknown[]) => void)(...args));
    };
  }
  build(recorder);
  for (const run of recorded) {
    step++;
    run(s);
  }
  return { state, engine, events };
}

export function createScenario(mods: readonly Mod[], opts: ScenarioOptions = {}): ScenarioFn {
  return (name, build) => {
    test(name, () => {
      runScenario(mods, build, opts);
    });
  };
}
