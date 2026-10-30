import {
  DIR_LIST,
  createEngine,
  getLevel,
  getPlayer,
  newMemory,
  type DefId,
  type Dir,
  type GameEvent,
  type GameState,
  type Level,
  type Pos,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import { T, messagesEn, vanillaMod } from '../src/index';

const CHARS: Record<string, DefId> = {
  ' ': T.stone,
  '|': T.vwall,
  '-': T.hwall,
  '.': T.floor,
  '+': T.door_closed,
  o: T.door_open_v,
  O: T.door_open_h,
  d: T.doorway,
};

/** Builds a level from ASCII rows (all lit). '@' marks the player's start (floor). */
function setup(rows: string[]): {
  state: GameState;
  step: (a: Parameters<Engine['step']>[1]) => GameEvent[];
} {
  const engine = createEngine([vanillaMod]);
  const { state } = engine.newGame({ seed: 1 });
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
  state.memory['dlvl1'] = newMemory(level);
  const pos = getPlayer(state).c.pos;
  if (!pos) throw new Error('no pos');
  pos.x = start.x;
  pos.y = start.y;
  // Re-sync vision by taking one no-op... the first step recomputes it.
  return { state, step: (a) => engine.step(state, a).events };
}
type Engine = ReturnType<typeof createEngine>;

const posOf = (s: GameState): Pos => {
  const p = getPlayer(s).c.pos;
  return { x: p?.x ?? -1, y: p?.y ?? -1 };
};
const terrainAt = (s: GameState, x: number, y: number): string => {
  const l = getLevel(s);
  return l.palette[l.cells[y * l.width + x] ?? 0] ?? '?';
};

describe('nh:move', () => {
  test('moves, emits moved, advances the turn', () => {
    const { state, step } = setup(['...', '.@.', '...']);
    const turn = state.turn;
    const ev = step({ type: 'move', dir: 'e' });
    expect(posOf(state)).toEqual({ x: 2, y: 1 });
    expect(ev).toContainEqual({
      type: 'moved',
      id: state.playerId,
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
    });
    expect(state.turn).toBe(turn + 1);
  });

  test('into a wall: no time, blocked event', () => {
    const { state, step } = setup(['.|', '@|']);
    const turn = state.turn;
    const ev = step({ type: 'move', dir: 'e' });
    expect(posOf(state)).toEqual({ x: 0, y: 1 });
    expect(state.turn).toBe(turn);
    expect(ev).toEqual([{ type: 'blocked', pos: { x: 1, y: 1 }, terrain: T.vwall }]);
  });

  test('out of bounds: no time, no event', () => {
    const { state, step } = setup(['@']);
    const turn = state.turn;
    expect(step({ type: 'move', dir: 'n' })).toEqual([]);
    expect(state.turn).toBe(turn);
  });

  test('diagonal into an open door is blocked', () => {
    const s2 = setup(['...', '.o.', '@..']);
    const ev = s2.step({ type: 'move', dir: 'ne' });
    expect(posOf(s2.state)).toEqual({ x: 0, y: 2 });
    expect(ev).toEqual([{ type: 'blocked', pos: { x: 1, y: 1 }, terrain: T.door_open_v }]);
  });

  test('diagonal out of an open door is blocked', () => {
    const { state, step } = setup(['...', '.@.', '...']);
    const l = getLevel(state);
    l.palette.push(T.door_open_h);
    l.cells[1 * l.width + 1] = l.palette.length - 1;
    const ev = step({ type: 'move', dir: 'se' });
    expect(posOf(state)).toEqual({ x: 1, y: 1 });
    expect(ev[0]?.type).toBe('blocked');
  });

  test('diagonal through a doorway is fine, both in and out', () => {
    const { state, step } = setup(['@..', '.d.', '...']);
    step({ type: 'move', dir: 'se' });
    expect(posOf(state)).toEqual({ x: 1, y: 1 });
    step({ type: 'move', dir: 'se' });
    expect(posOf(state)).toEqual({ x: 2, y: 2 });
  });

  test('closed door in a vertical wall opens as door_open_v', () => {
    const { state, step } = setup(['.|.', '@+.', '.|.']);
    // door at (1,1) with walls N and S
    const turn = state.turn;
    const ev = step({ type: 'move', dir: 'e' });
    expect(terrainAt(state, 1, 1)).toBe(T.door_open_v);
    expect(posOf(state)).toEqual({ x: 0, y: 1 });
    expect(ev).toEqual([
      { type: 'doorOpened', pos: { x: 1, y: 1 } },
      { type: 'msg', key: 'door.opens' },
      { type: 'turnEnded', turn: turn + 1 },
    ]);
    expect(state.turn).toBe(turn + 1);
    expect(messagesEn['door.opens']).toBeDefined();
    // now the player can walk through
    step({ type: 'move', dir: 'e' });
    expect(posOf(state)).toEqual({ x: 1, y: 1 });
  });

  test('closed door in a horizontal wall opens as door_open_h', () => {
    const { state, step } = setup(['.@.', '-+-', '...']);
    step({ type: 'move', dir: 's' });
    expect(terrainAt(state, 1, 1)).toBe(T.door_open_h);
    expect(posOf(state)).toEqual({ x: 1, y: 0 });
  });

  test('door at the level edge counts out of bounds as not passable', () => {
    const { state, step } = setup(['@+']);
    step({ type: 'move', dir: 'e' });
    expect(terrainAt(state, 1, 0)).toBe(T.door_open_v);
  });

  test('palette is appended to, never reordered', () => {
    const { state, step } = setup(['.|.', '@+.', '.|.']);
    const before = [...getLevel(state).palette];
    step({ type: 'move', dir: 'e' });
    expect(getLevel(state).palette.slice(0, before.length)).toEqual(before);
    expect(getLevel(state).palette).toHaveLength(before.length + 1);
  });

  test('opening reuses an existing palette entry', () => {
    const { state, step } = setup(['.|.', '@+o', '.|.']);
    const len = getLevel(state).palette.length;
    step({ type: 'move', dir: 'e' });
    expect(getLevel(state).palette).toHaveLength(len);
  });
});

describe('nh:wait / nh:search', () => {
  test('wait costs a turn, no events', () => {
    const { state, step } = setup(['@']);
    const turn = state.turn;
    expect(step({ type: 'wait' })).toEqual([{ type: 'turnEnded', turn: turn + 1 }]);
    expect(state.turn).toBe(turn + 1);
  });
  test('search costs a turn and emits searched', () => {
    const { state, step } = setup(['@']);
    const turn = state.turn;
    expect(step({ type: 'search' })).toEqual([
      { type: 'searched' },
      { type: 'turnEnded', turn: turn + 1 },
    ]);
    expect(state.turn).toBe(turn + 1);
  });
});

describe('offers', () => {
  const engine = createEngine([vanillaMod]);
  const queryFor = (rows: string[]) => {
    const { state } = setup(rows);
    return { state, q: engine.query(state) };
  };

  test('self offers wait and search with source nh', () => {
    const { q } = queryFor(['@']);
    // plus the item actions that apply anywhere: drop several (the kit) and discoveries
    expect(q.actionsFor({ kind: 'self' })).toEqual([
      { action: { type: 'wait' }, labelKey: 'action.wait', source: 'nh' },
      { action: { type: 'search' }, labelKey: 'action.search', source: 'nh' },
      {
        action: { type: 'mod', action: 'nh:drop_many' },
        labelKey: 'action.nh:drop_many',
        source: 'nh',
      },
      {
        action: { type: 'mod', action: 'nh:discoveries' },
        labelKey: 'action.nh:discoveries',
        source: 'nh',
      },
    ]);
  });

  test('player entity maps to self', () => {
    const { state, q } = queryFor(['@']);
    expect(q.actionsFor({ kind: 'entity', id: state.playerId })).toEqual(
      q.actionsFor({ kind: 'self' }),
    );
  });

  test('each walkable adjacent cell offers a move', () => {
    const { q } = queryFor(['...', '.@.', '...']);
    const offered: Dir[] = [];
    for (const dir of DIR_LIST) {
      const d = {
        n: [0, -1],
        ne: [1, -1],
        e: [1, 0],
        se: [1, 1],
        s: [0, 1],
        sw: [-1, 1],
        w: [-1, 0],
        nw: [-1, -1],
      }[dir];
      const offers = q.actionsFor({
        kind: 'cell',
        pos: { x: 1 + (d?.[0] ?? 0), y: 1 + (d?.[1] ?? 0) },
      });
      expect(offers).toEqual([
        {
          action: { type: 'move', dir },
          labelKey: 'action.move',
          params: { dir: `@dir.${dir}` },
          source: 'nh',
        },
      ]);
      expect(messagesEn[`dir.${dir}`]).toBeDefined();
      offered.push(dir);
    }
    expect(offered).toHaveLength(8);
  });

  test('closed doors are offered; walls, far cells, own cell and entities are not', () => {
    const { q } = queryFor(['.|.', '@+.', '...']);
    expect(q.actionsFor({ kind: 'cell', pos: { x: 1, y: 1 } })).toHaveLength(1);
    expect(q.actionsFor({ kind: 'cell', pos: { x: 1, y: 0 } })).toEqual([]);
    expect(q.actionsFor({ kind: 'cell', pos: { x: 2, y: 2 } })).toEqual([]);
    expect(q.actionsFor({ kind: 'cell', pos: { x: 0, y: 1 } })).toEqual([]);
    expect(q.actionsFor({ kind: 'entity', id: 999 })).toEqual([]);
  });

  test('diagonal into an open door is not offered', () => {
    const { q } = queryFor(['...', '.o.', '@..']);
    expect(q.actionsFor({ kind: 'cell', pos: { x: 1, y: 1 } })).toEqual([]);
  });
});
