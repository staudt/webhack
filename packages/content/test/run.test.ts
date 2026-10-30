import { describe, expect, test } from 'vitest';
import { messagesEn } from '../src/index';
import { dropAt, heroAt, mapSetup, newtAt, runDir } from './maps';

const msgs = (events: { type: string; key?: string }[]): string[] =>
  events.flatMap((e) => (e.type === 'msg' && e.key ? [e.key] : []));

describe('nh:run offers', () => {
  const rows = Array.from({ length: 9 }, (_, y) => (y === 4 ? '....@....' : '.........'));
  const offersAt = (x: number, y: number) => {
    const m = mapSetup(rows);
    return engine
      .query(m.state)
      .actionsFor({ kind: 'cell', pos: { x, y } })
      .filter((o) => o.action.type === 'mod' && o.action.action === 'nh:run');
  };
  const dirOf = (x: number, y: number) =>
    (offersAt(x, y)[0]?.action as unknown as { args: { dir: string } }).args.dir;

  test('cell targets get rush, run and shift; own cell and out of bounds none', () => {
    expect(offersAt(4, 4)).toHaveLength(0); // own cell
    expect(offersAt(5, 4)).toHaveLength(0); // adjacent: move/attack only
    expect(offersAt(40, 4)).toHaveLength(0);
    const e = offersAt(8, 4);
    expect(e.map((o) => o.action)).toEqual([
      { type: 'mod', action: 'nh:run', args: { dir: 'e', mode: 'rush' } },
      { type: 'mod', action: 'nh:run', args: { dir: 'e', mode: 'run' } },
      { type: 'mod', action: 'nh:run', args: { dir: 'e', mode: 'shift' } },
    ]);
    expect(e[0]?.params).toEqual({ dir: '@dir.e' });
    expect(messagesEn['action.run.rush']).toBe('Rush {dir}');
  });

  test('the direction is the nearest of the eight', () => {
    expect(dirOf(6, 4)).toBe('e');
    expect(dirOf(8, 0)).toBe('ne');
    expect(dirOf(0, 0)).toBe('nw');
    expect(dirOf(0, 8)).toBe('sw');
    expect(dirOf(8, 8)).toBe('se');
    expect(dirOf(4, 8)).toBe('s');
    expect(dirOf(4, 0)).toBe('n');
    expect(dirOf(8, 3)).toBe('e'); // 4:1 slope
    expect(dirOf(8, 2)).toBe('e'); // 2:1 slope is still straight
    expect(dirOf(8, 1)).toBe('ne'); // steeper than 2:1 on the other axis
    expect(dirOf(6, 0)).toBe('n'); // 1:2 is still straight
    expect(dirOf(5, 0)).toBe('n'); // 1:4
  });
});

import { engine } from './itemHelpers';

describe('nh:run in a room', () => {
  test('rush runs straight to the wall', () => {
    const m = mapSetup(['|.......|', '|.@.....|', '|.......|']);
    m.step(runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 7, y: 1 });
  });

  test('a wall in the way stops it without taking time', () => {
    const m = mapSetup(['|@|']);
    const turn = m.state.turn;
    m.step(runDir('e', 'run'));
    expect(heroAt(m.state)).toEqual({ x: 1, y: 0 });
    expect(m.state.turn).toBe(turn);
  });

  test('rush stops beside an open doorway; shift does not', () => {
    const rows = ['|.....|', '|@....o', '|.....|'];
    // rush: the doorway is "interesting" once it is next to us
    const a = mapSetup(rows);
    a.step(runDir('e', 'rush'));
    expect(heroAt(a.state)).toEqual({ x: 5, y: 1 });
    // shift: runs on and ends on the doorway (doors stop a run after entering)
    const b = mapSetup(rows);
    b.step(runDir('e', 'shift'));
    expect(heroAt(b.state)).toEqual({ x: 6, y: 1 });
  });

  test('stops in front of a closed door in rush and run, and does not open it', () => {
    const rows = ['|.....|', '|@....+', '|.....|'];
    for (const mode of ['rush', 'run']) {
      const m = mapSetup(rows);
      m.step(runDir('e', mode));
      expect(heroAt(m.state)).toEqual({ x: 5, y: 1 });
    }
    const s = mapSetup(rows);
    const r = s.step(runDir('e', 'shift'));
    expect(heroAt(s.state)).toEqual({ x: 5, y: 1 });
    expect(msgs(r.events)).toContain('door.closed');
  });

  test('stops on stairs', () => {
    const m = mapSetup(['|@...>..|']);
    m.step(runDir('e', 'rush'));
    // like NetHack: stops before the stairs in front of it
    expect(heroAt(m.state)).toEqual({ x: 4, y: 0 });
  });

  test('shift runs onto stairs and stops there', () => {
    const m = mapSetup(['|@...>..|']);
    m.step(runDir('e', 'shift'));
    expect(heroAt(m.state)).toEqual({ x: 5, y: 0 });
  });

  test('stops on an object', () => {
    const m = mapSetup(['|@.....|']);
    dropAt(m, 3, 0);
    const r = m.step(runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
    expect(msgs(r.events)).toContain('look.one');
  });

  test('stops next to a monster and never attacks it', () => {
    const m = mapSetup(['|@......|', '|.......|']);
    const id = newtAt(m.state, 5, 1);
    m.step({ type: 'wait' });
    m.step(runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 4, y: 0 });
    expect(m.state.entities[String(id)]?.c.hp?.cur).toBe(3);
  });

  test('a monster in the path is not attacked', () => {
    const m = mapSetup(['|@.|']);
    const id = newtAt(m.state, 2, 0);
    m.step({ type: 'wait' });
    const turn = m.state.turn;
    m.step(runDir('e', 'shift'));
    expect(heroAt(m.state)).toEqual({ x: 1, y: 0 });
    expect(m.state.entities[String(id)]?.c.hp?.cur).toBe(3);
    expect(m.state.turn).toBe(turn);
  });

  test('a hostile monster coming into view stops the run', () => {
    // the newt sleeps down a side passage and is only in line of sight from x = 4
    const m = mapSetup(['|.........|', '|@........|', '|---.-----|', '    .      ', '    .      ']);
    const id = newtAt(m.state, 4, 4);
    m.step({ type: 'wait' });
    expect(m.state.visible).not.toContain(4 * 11 + 4);
    m.step(runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 4, y: 1 });
    expect(m.state.entities[String(id)]?.c.hp?.cur).toBe(3);
  });

  test('a peaceful monster coming into view does not', () => {
    const m = mapSetup(['|.........|', '|@........|', '|---.-----|', '    .      ', '    .      ']);
    newtAt(m.state, 4, 4, true);
    m.step({ type: 'wait' });
    m.step(runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 9, y: 1 });
  });
});

describe('nh:run in corridors', () => {
  const bend = ['|@#####', '       #', '       #', '       #'];

  test('shift and run follow a corridor around corners', () => {
    for (const mode of ['shift', 'run']) {
      const m = mapSetup(bend);
      m.step(runDir('e', mode));
      expect(heroAt(m.state)).toEqual({ x: 7, y: 3 });
    }
  });

  test('rush does not turn', () => {
    const m = mapSetup(bend);
    m.step(runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 6, y: 0 });
  });

  test('a diagonal turn is followed', () => {
    const m = mapSetup(['@##    ', '   #   ', '    #  ', '     # ']);
    m.step(runDir('e', 'run'));
    expect(heroAt(m.state)).toEqual({ x: 5, y: 3 });
  });

  test('stops at a fork', () => {
    const m = mapSetup(['@####   ', '    #   ', '    ### ', '        ']);
    // at (3,0) the corridor forks south-east/east: (4,0) then (4,1)
    m.step(runDir('e', 'run'));
    expect(heroAt(m.state).x).toBeGreaterThanOrEqual(3);
    // a Y-fork
    const f = mapSetup(['@###     ', '   #     ', '   ##    ', '    #    ', '   #     ']);
    f.step(runDir('e', 'run'));
    const p = heroAt(f.state);
    expect(p.y).toBeLessThan(4);
  });

  test('stops at a T junction', () => {
    const m = mapSetup(['    #    ', '@####    ', '    #    ']);
    m.step(runDir('e', 'run'));
    // runs on to the junction and stops there: nothing straight ahead and two ways to turn
    expect(heroAt(m.state)).toEqual({ x: 4, y: 1 });
  });

  test('stops where a corridor meets a doorway', () => {
    const m = mapSetup(['@###o..|', '    |..|']);
    m.step(runDir('e', 'run'));
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
  });
});

describe('nh:run', () => {
  test('invalid arguments do nothing', () => {
    const m = mapSetup(['@....']);
    const turn = m.state.turn;
    m.step({ type: 'mod', action: 'nh:run', args: { dir: 'x', mode: 'rush' } });
    m.step({ type: 'mod', action: 'nh:run', args: { dir: 'e', mode: 'zoom' } });
    expect(heroAt(m.state)).toEqual({ x: 0, y: 0 });
    expect(m.state.turn).toBe(turn);
  });

  test('deterministic', () => {
    const run = () => {
      const m = mapSetup(['|@#####', '       #', '       #']);
      m.step(runDir('e', 'run'));
      return JSON.stringify(m.state);
    };
    expect(run()).toBe(run());
  });
});
