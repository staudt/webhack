import { createEngine, getLevel, getPlayer, type GameState, type Pos } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { vanillaMod } from '../src/index';

const DOWN = { type: 'mod', action: 'nh:down' } as const;
const UP = { type: 'mod', action: 'nh:up' } as const;

function start(seed = 1) {
  const engine = createEngine([vanillaMod]);
  const { state } = engine.newGame({ seed });
  const pos = (s: GameState): Pos & { level: string } => {
    const p = getPlayer(s).c.pos;
    if (!p) throw new Error('no pos');
    return { level: p.level, x: p.x, y: p.y };
  };
  const put = (s: GameState, p: Pos): void => {
    const hp = getPlayer(s).c.pos;
    if (!hp) throw new Error('no pos');
    hp.x = p.x;
    hp.y = p.y;
  };
  const offers = (s: GameState): string[] =>
    engine
      .query(s)
      .actionsFor({ kind: 'self' })
      .map((o) => o.labelKey);
  return { engine, state, pos, put, offers };
}

describe('stairs', () => {
  test('actionsFor offers down only on > and up only on <', () => {
    const { state, put, offers } = start();
    const level = getLevel(state);
    const { up, down } = level;
    if (!up || !down) throw new Error('level has no stairs');
    expect(offers(state)).toContain('action.up'); // hero starts on the up stairs
    expect(offers(state)).not.toContain('action.down');
    put(state, down);
    expect(offers(state)).toContain('action.down');
    expect(offers(state)).not.toContain('action.up');
    const room = level.rooms[0];
    if (!room) throw new Error('no room');
    // any floor cell that is neither staircase offers neither
    for (let y = room.ly; y <= room.hy; y++)
      for (let x = room.lx; x <= room.hx; x++) {
        if ((x === up.x && y === up.y) || (x === down.x && y === down.y)) continue;
        put(state, { x, y });
        expect(offers(state)).not.toContain('action.up');
        expect(offers(state)).not.toContain('action.down');
        return;
      }
  });

  test('down then up returns to the same remembered level and stairs', () => {
    const { engine, state, pos, put } = start();
    const l1 = getLevel(state);
    const down1 = l1.down as Pos;
    const up1 = l1.up as Pos;
    put(state, down1);
    engine.step(state, DOWN);
    const p2 = pos(state);
    expect(p2.level).not.toBe(l1.id);
    const l2 = getLevel(state);
    expect(l2.depth).toBe(2);
    expect({ x: p2.x, y: p2.y }).toEqual(l2.up);
    const l2Cells = [...l2.cells];

    engine.step(state, UP);
    const p1 = pos(state);
    expect(p1.level).toBe(l1.id);
    expect({ x: p1.x, y: p1.y }).toEqual(down1);
    expect(getLevel(state)).toBe(l1);
    expect(l1.up).toEqual(up1);

    // second visit does not regenerate
    engine.step(state, DOWN);
    expect(getLevel(state)).toBe(l2);
    expect(l2.cells).toEqual(l2Cells);
    expect(Object.keys(state.levels)).toHaveLength(2);
  });

  test('down away from stairs: message, no time', () => {
    const { engine, state, put } = start();
    const l = getLevel(state);
    put(state, l.up as Pos);
    const turn = state.turn;
    const ev = engine.step(state, DOWN).events;
    expect(ev).toContainEqual({ type: 'msg', key: 'stairs.cant_down' });
    expect(state.turn).toBe(turn);
  });

  test('leaving from dlvl 1: prompt, no answers keeps playing', () => {
    const { engine, state, pos } = start();
    const before = pos(state);
    const res = engine.step(state, UP);
    expect(res.prompt).toMatchObject({
      id: 'leave-dungeon',
      kind: 'yn',
      key: 'stairs.leave_confirm',
    });
    expect(state.pendingPrompt).not.toBeNull();
    const turn = state.turn;
    const after = engine.step(state, { type: 'answer', promptId: 'leave-dungeon', value: false });
    expect(after.events).toEqual([]);
    expect(state.gameOver).toBeNull();
    expect(state.pendingPrompt).toBeNull();
    expect(state.turn).toBe(turn);
    expect(pos(state)).toEqual(before);
    engine.step(state, { type: 'wait' }); // still playable
  });

  test('answering yes escapes and ends the game', () => {
    const { engine, state } = start();
    engine.step(state, UP);
    engine.step(state, { type: 'answer', promptId: 'leave-dungeon', value: true });
    expect(state.gameOver).toMatchObject({
      kind: 'escaped',
      killer: 'escaped',
      depth: 1,
      level: 1,
    });
    expect(() => engine.step(state, { type: 'wait' })).toThrow();
  });

  test('up from dlvl 2 goes without a prompt', () => {
    const { engine, state, put } = start();
    put(state, getLevel(state).down as Pos);
    engine.step(state, DOWN);
    const res = engine.step(state, UP);
    expect(res.prompt).toBeNull();
    expect(getLevel(state).depth).toBe(1);
  });
});
