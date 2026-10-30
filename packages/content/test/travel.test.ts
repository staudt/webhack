import {
  createEngine,
  getPlayer,
  newMemory,
  type DefId,
  type GameEvent,
  type GameState,
  type Level,
  type Pos,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import { T, messagesEn, vanillaMod } from '../src/index';
import { heroAt, mapSetup, newtAt, travelTo } from './maps';

const CHARS: Record<string, DefId> = {
  ' ': T.stone,
  '|': T.vwall,
  '-': T.hwall,
  '.': T.floor,
  '+': T.door_closed,
};

/** Builds a lit level from ASCII rows with the hero at '@'; everything is remembered. */
function setup(rows: string[], opts: { forget?: Pos[] } = {}) {
  const engine = createEngine([vanillaMod]);
  const { state } = engine.newGame({ seed: 1 });
  for (const id of Object.keys(state.entities))
    if (Number(id) !== state.playerId) delete state.entities[id];
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const palette: DefId[] = [T.stone, T.floor];
  const cells: number[] = [];
  let start: Pos = { x: 0, y: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ch = rows[y]?.[x] ?? ' ';
      if (ch === '@') {
        start = { x, y };
        ch = '.';
      }
      const id = CHARS[ch] ?? T.stone;
      let i = palette.indexOf(id);
      if (i === -1) i = palette.push(id) - 1;
      cells.push(i);
    }
  }
  const level: Level = {
    id: 'dlvl1',
    depth: 1,
    width,
    height,
    palette,
    cells,
    lit: cells.map(() => 1),
    rooms: [],
    up: null,
    down: null,
  };
  state.levels['dlvl1'] = level;
  const memory = newMemory(level);
  for (let i = 0; i < cells.length; i++) memory[i] = cells[i] ?? 0;
  for (const p of opts.forget ?? []) memory[p.y * width + p.x] = -1;
  state.memory['dlvl1'] = memory;
  const pos = getPlayer(state).c.pos;
  if (!pos) throw new Error('no pos');
  pos.x = start.x;
  pos.y = start.y;
  const step = (a: Parameters<typeof engine.step>[1]): GameEvent[] => engine.step(state, a).events;
  return { engine, state, step };
}

const go = (x: number, y: number) => ({
  type: 'mod' as const,
  action: 'nh:travel' as const,
  args: { x, y },
});
const posOf = (s: GameState): Pos => {
  const p = getPlayer(s).c.pos;
  return { x: p?.x ?? -1, y: p?.y ?? -1 };
};

function addNewt(
  state: GameState,
  step: (a: { type: 'wait' }) => unknown,
  x: number,
  y: number,
): void {
  const id = state.nextEntityId++;
  state.entities[String(id)] = {
    id,
    def: 'nh:newt',
    c: {
      pos: { level: 'dlvl1', x, y },
      actor: { energy: 0, speed: 6 },
      hp: { cur: 3, max: 3 },
      monster: { level: 0, peaceful: false, asleep: true, lastHero: null },
    },
  };
  step({ type: 'wait' }); // refresh vision so the monster is seen
}

describe('nh:travel', () => {
  test('one step() travels the whole way', () => {
    const { state, step } = setup(['@.........']);
    const turn = state.turn;
    step(go(9, 0));
    expect(posOf(state)).toEqual({ x: 9, y: 0 });
    expect(state.turn).toBe(turn + 9);
  });

  test('opens a closed door on the way and continues', () => {
    const { state, step } = setup(['.|...', '@+...', '.|...']);
    const turn = state.turn;
    const ev = step(go(4, 1));
    expect(ev).toContainEqual({ type: 'doorOpened', pos: { x: 1, y: 1 } });
    expect(posOf(state)).toEqual({ x: 4, y: 1 });
    expect(state.turn).toBe(turn + 5); // 1 to open + 4 steps
  });

  test('offers: none for own/adjacent cells, one for any other in-bounds cell', () => {
    const { engine, state } = setup(['@..|..', '...|..'], { forget: [{ x: 2, y: 1 }] });
    const q = engine.query(state);
    const offers = (x: number, y: number) =>
      q
        .actionsFor({ kind: 'cell', pos: { x, y } })
        .filter((o) => o.action.type === 'mod' && o.action.action === 'nh:travel');
    expect(offers(0, 0)).toHaveLength(0);
    expect(offers(1, 1)).toHaveLength(0);
    expect(offers(2, 1)).toHaveLength(1); // unknown
    expect(offers(4, 0)).toHaveLength(1); // unreachable behind a wall
    expect(offers(99, 0)).toHaveLength(0); // out of bounds
    const far = offers(2, 0);
    expect(far).toHaveLength(1);
    expect(far[0]?.action).toEqual(go(2, 0));
    expect(far[0]?.labelKey).toBe('action.travel');
    expect(messagesEn['action.travel']).toBe('Travel here');
  });

  test('stops next to a hostile monster that comes into the neighbourhood, without attacking', () => {
    const { state, step } = setup(['@.........', '..........', '..........']);
    addNewt(state, step, 5, 1);
    const hp = getPlayer(state).c.hp?.cur;
    step(go(9, 0));
    expect(posOf(state)).toEqual({ x: 4, y: 0 });
    expect(state.entities[String(state.nextEntityId - 1)]?.c.hp?.cur).toBe(3);
    expect(getPlayer(state).c.hp?.cur).toBe(hp);
  });

  test('a monster standing in the path cell stops travel without attacking', () => {
    const { state, step } = setup(['@..', '|||']);
    addNewt(state, step, 1, 0);
    const turn = state.turn;
    // first step is refused: the newt is in the only path cell
    step(go(2, 0));
    expect(posOf(state)).toEqual({ x: 0, y: 0 });
    expect(state.turn).toBe(turn);
    expect(state.entities[String(state.nextEntityId - 1)]?.c.hp?.cur).toBe(3);
  });

  test('an unreachable target: walks to the nearest reachable point', () => {
    const { state, step } = setup(['@.|..']);
    const turn = state.turn;
    step(go(4, 0));
    expect(posOf(state)).toEqual({ x: 1, y: 0 });
    expect(state.turn).toBe(turn + 1);
  });

  test('deterministic', () => {
    const run = () => {
      const { state, step } = setup(['.|...', '@+...', '.|...']);
      step(go(4, 1));
      return JSON.stringify(state);
    };
    expect(run()).toBe(run());
  });
});

describe('nh:travel guess (findtravelpath TRAVP_GUESS)', () => {
  test('an unexplored target past a corridor bend: goes to the explored end', () => {
    const m = mapSetup(['@###     ', '   #     ', '   #     ', '   #     '], { memory: 'none' });
    m.step(travelTo(8, 0));
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
  });

  test('an unexplored target straight ahead in a dark corridor: walks right up to it', () => {
    const m = mapSetup(['@#####'], { memory: 'none' });
    m.step(travelTo(5, 0));
    expect(heroAt(m.state)).toEqual({ x: 5, y: 0 });
  });

  test('nothing explored in that direction: one step', () => {
    const m = mapSetup(['@#    '], { memory: 'none' });
    const turn = m.state.turn;
    m.step(travelTo(5, 0));
    expect(heroAt(m.state)).toEqual({ x: 1, y: 0 });
    expect(m.state.turn).toBe(turn + 1);
  });

  test('a known but unreachable cell: goes to the closest reachable point', () => {
    const m = mapSetup(['@..|..', '...|..']);
    m.step(travelTo(5, 0));
    expect(heroAt(m.state)).toEqual({ x: 2, y: 0 });
  });

  test('blocked in the target direction: no time passes', () => {
    const m = mapSetup(['@|', '||']);
    const turn = m.state.turn;
    m.step(travelTo(5, 0));
    expect(heroAt(m.state)).toEqual({ x: 0, y: 0 });
    expect(m.state.turn).toBe(turn);
  });

  test('a hostile monster coming into view stops guessed travel', () => {
    const m = mapSetup(['@....#####', '..........']);
    newtAt(m.state, 9, 1);
    m.step({ type: 'wait' });
    const turn = m.state.turn;
    m.step(travelTo(9, 0));
    // the newt was in view from the start, so it is the adjacent check that stops us
    expect(heroAt(m.state).x).toBeLessThan(9);
    expect(m.state.turn).toBeGreaterThan(turn);
  });

  test('deterministic', () => {
    const run = () => {
      const m = mapSetup(['@###     ', '   #     ', '   #     '], { memory: 'none' });
      m.step(travelTo(8, 0));
      return JSON.stringify(m.state);
    };
    expect(run()).toBe(run());
  });
});
