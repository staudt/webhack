import { describe, expect, test } from 'vitest';
import { DIR_LIST, isJsonPlain, type DefId, type Target } from '@nh/core';
import { messagesEn } from '../src/index';
import { dropAt, heroAt, mapSetup, newtAt, runDir } from './maps';
import { engine } from './itemHelpers';

const msgs = (events: { type: string; key?: string }[]): string[] =>
  events.flatMap((e) => (e.type === 'msg' && e.key ? [e.key] : []));

describe('nh:run offers', () => {
  const rows = Array.from({ length: 9 }, (_, y) => (y === 4 ? '....@....' : '.........'));
  const runOffers = (target: Target) =>
    engine
      .query(mapSetup(rows).state)
      .actionsFor(target)
      .filter((o) => o.action.type === 'mod' && o.action.action === 'nh:run');

  test('one self offer; cells offer no run', () => {
    const own = runOffers({ kind: 'self' });
    expect(own.map((o) => o.action)).toEqual([{ type: 'mod', action: 'nh:run' }]);
    expect(own[0]?.labelKey).toBe('action.run');
    expect(messagesEn['action.run']).toBe('Run');
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [8, 4],
      [0, 0],
      [40, 4],
    ] as const)
      expect(runOffers({ kind: 'cell', pos: { x, y } })).toHaveLength(0);
  });
});

describe('nh:run direction prompt', () => {
  const room = ['|.......|', '|.@.....|', '|.......|'];
  const ask = (m: ReturnType<typeof mapSetup>) => {
    const r = engine.step(m.state, { type: 'mod', action: 'nh:run' as DefId });
    expect(r.continuing).toBe(false);
    const p = m.state.pendingPrompt;
    expect(p?.handler).toBe('nh:run');
    expect(p?.prompt.kind).toBe('direction');
    return p;
  };

  test('asks for a direction with eight options and costs nothing', () => {
    const m = mapSetup(room);
    const turn = m.state.turn;
    const p = ask(m);
    expect(p?.prompt.options?.map((o) => o.value)).toEqual(DIR_LIST);
    expect(p?.prompt.options?.[0]?.key).toBe(`dir.${DIR_LIST[0]}`);
    expect(m.state.turn).toBe(turn);
  });

  test('the answer rushes one move, then continue steps run on until it stops', () => {
    const m = mapSetup(room);
    const p = ask(m);
    const r1 = engine.step(m.state, { type: 'answer', promptId: p!.prompt.id, value: 'e' });
    expect(heroAt(m.state)).toEqual({ x: 3, y: 1 });
    expect(r1.continuing).toBe(true);
    expect(m.state.occupation?.action).toEqual({
      type: 'mod',
      action: 'nh:run',
      args: { dir: 'e', mode: 'rush' },
    });
    let last = r1;
    for (let i = 0; i < 10 && last.continuing; i++)
      last = engine.step(m.state, { type: 'continue' });
    expect(heroAt(m.state)).toEqual({ x: 7, y: 1 });
    expect(m.state.occupation).toBeNull();
  });

  test('another action cancels it', () => {
    const m = mapSetup(room);
    const p = ask(m);
    engine.step(m.state, { type: 'answer', promptId: p!.prompt.id, value: 'e' });
    engine.step(m.state, { type: 'move', dir: 'n' });
    expect(m.state.occupation).toBeNull();
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
    engine.step(m.state, { type: 'continue' });
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
  });

  test('a first move into a wall ends at once', () => {
    const m = mapSetup(['|@...|']);
    const p = ask(m);
    const r = engine.step(m.state, { type: 'answer', promptId: p!.prompt.id, value: 'w' });
    expect(heroAt(m.state)).toEqual({ x: 1, y: 0 });
    expect(r.continuing).toBe(false);
    expect(m.state.occupation).toBeNull();
  });

  test('a bad answer costs nothing and does nothing', () => {
    const m = mapSetup(room);
    const p = ask(m);
    const turn = m.state.turn;
    const r = engine.step(m.state, { type: 'answer', promptId: p!.prompt.id, value: 'up' });
    expect(heroAt(m.state)).toEqual({ x: 2, y: 1 });
    expect(m.state.turn).toBe(turn);
    expect(r.continuing).toBe(false);
    expect(m.state.occupation).toBeNull();
  });
});

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

describe('nh:run one move per step', () => {
  test('step() moves once; continue runs on, with progress in occupation.data', () => {
    const m = mapSetup(['|.......|', '|.@.....|', '|.......|']);
    const r1 = engine.step(m.state, runDir('e', 'rush'));
    expect(heroAt(m.state)).toEqual({ x: 3, y: 1 });
    expect(r1.continuing).toBe(true);
    expect(m.state.occupation?.data).toMatchObject({ dx: 1, dy: 0, moved: true });
    const r2 = engine.step(m.state, { type: 'continue' });
    expect(heroAt(m.state)).toEqual({ x: 4, y: 1 });
    expect(r2.continuing).toBe(true);
    expect(isJsonPlain(m.state.occupation)).toBe(true);
    let last = r2;
    for (let i = 0; i < 10 && last.continuing; i++)
      last = engine.step(m.state, { type: 'continue' });
    expect(heroAt(m.state)).toEqual({ x: 7, y: 1 });
    expect(m.state.occupation).toBeNull();
  });

  test('another action cancels the run and is performed', () => {
    const m = mapSetup(['|.......|', '|.@.....|', '|.......|']);
    engine.step(m.state, runDir('e', 'rush'));
    engine.step(m.state, { type: 'move', dir: 'n' });
    expect(m.state.occupation).toBeNull();
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
    engine.step(m.state, { type: 'continue' });
    expect(heroAt(m.state)).toEqual({ x: 3, y: 0 });
  });
});
