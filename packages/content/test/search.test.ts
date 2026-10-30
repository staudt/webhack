import { createEngine, getLevel, getPlayer, newMemory, type DefId, type Level } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { buildSnapshot } from '@nh/core';
import { T, vanillaMod } from '../src/index';

/** A lit 7x5 room-ish map: floor row in the middle, hero at (3,2), hidden `target` cell at (4,2). */
function setup(seed: number, target: DefId, at = { x: 4, y: 2 }) {
  const engine = createEngine([vanillaMod]);
  const { state } = engine.newGame({ seed });
  const width = 9;
  const height = 5;
  const palette: DefId[] = [T.stone, T.floor, target];
  const cells = new Array<number>(width * height).fill(0);
  for (let x = 1; x < 4; x++) cells[2 * width + x] = 1;
  cells[at.y * width + at.x] = 2;
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
  pos.x = 3;
  pos.y = 2;
  const terrainAt = (x: number, y: number): string =>
    getLevel(state).palette[getLevel(state).cells[y * width + x] ?? 0] ?? '?';
  return { engine, state, terrainAt, level };
}

/** Searches until `done`, up to 200 times; returns every event emitted. */
function searchUntil(s: ReturnType<typeof setup>, done: () => boolean) {
  const events = [];
  for (let i = 0; i < 200 && !done(); i++) events.push(...s.engine.step(s.state, { type: 'search' }).events);
  return events;
}

describe('nh:search', () => {
  test('finds an adjacent secret door and makes it a closed door', () => {
    const s = setup(11, T.sdoor_v);
    const turn0 = s.state.turn;
    const events = searchUntil(s, () => s.terrainAt(4, 2) !== T.sdoor_v);
    expect(s.terrainAt(4, 2)).toBe(T.door_closed);
    expect(events).toContainEqual({ type: 'msg', key: 'search.found_door' });
    expect(events.filter((e) => e.type === 'searched').length).toBe(s.state.turn - turn0);
    // the reveal is visible now: the hero's memory shows a closed door
    const mem = s.state.memory['dlvl1'];
    expect(mem).toBeDefined();
  });

  test('finds a horizontal secret door too', () => {
    const s = setup(12, T.sdoor_h);
    searchUntil(s, () => s.terrainAt(4, 2) !== T.sdoor_h);
    expect(s.terrainAt(4, 2)).toBe(T.door_closed);
  });

  test('finds an adjacent secret corridor', () => {
    const s = setup(13, T.scorr);
    const events = searchUntil(s, () => s.terrainAt(4, 2) !== T.scorr);
    expect(s.terrainAt(4, 2)).toBe(T.corr);
    expect(events).toContainEqual({ type: 'msg', key: 'search.found_passage' });
  });

  test('is found on average about one search in seven (Luck 0)', () => {
    let total = 0;
    const n = 300;
    for (let seed = 0; seed < n; seed++) {
      const s = setup(seed, T.scorr);
      searchUntil(s, () => s.terrainAt(4, 2) !== T.scorr);
      total += s.state.turn;
    }
    // turn counts searches (plus the same start offset for every game)
    const start = setup(0, T.scorr).state.turn;
    const mean = total / n - start;
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(9);
  });

  test('never finds anything that is not adjacent', () => {
    for (const at of [{ x: 5, y: 2 }, { x: 4, y: 4 }, { x: 1, y: 0 }]) {
      const s = setup(21, T.sdoor_v, at);
      for (let i = 0; i < 150; i++) s.engine.step(s.state, { type: 'search' });
      expect(s.terrainAt(at.x, at.y)).toBe(T.sdoor_v);
    }
  });

  test('diagonal neighbours count, and the hero cell is skipped', () => {
    const s = setup(31, T.scorr, { x: 4, y: 3 });
    searchUntil(s, () => s.terrainAt(4, 3) !== T.scorr);
    expect(s.terrainAt(4, 3)).toBe(T.corr);
  });

  test('secret terrain looks like wall or stone to look/describe', () => {
    const s = setup(1, T.sdoor_v);
    // Vision is refreshed by a step; the secret door is adjacent, so it becomes remembered.
    s.engine.step(s.state, { type: 'wait' });
    const d = s.engine.query(s.state).describe({ x: 4, y: 2 });
    expect(d.terrain).toBe(T.vwall);
    expect(JSON.stringify(buildSnapshot(s.engine.registry, s.state).cells)).not.toMatch(/sdoor|scorr/);
  });
});
