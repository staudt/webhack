import { vanillaMod, T } from '@nh/content';
import { expect, test } from 'vitest';
import { createScenario, runScenario } from '../src/index';

const scenario = createScenario([vanillaMod]);

const ROOM = [
  '-------',
  '|.....|',
  '|..@..|',
  '|.....|',
  '-------',
];

scenario('walk in a lit room', (s) => {
  s.level(ROOM);
  s.expectPos({ x: 3, y: 2 });
  s.expectTurn(1);
  s.act({ type: 'move', dir: 'e' });
  s.expectPos({ x: 4, y: 2 });
  s.expectEvent({ type: 'moved', from: { x: 3, y: 2 }, to: { x: 4, y: 2 } });
  s.expectTurn(2);
  s.act([{ type: 'move', dir: 'n' }, { type: 'move', dir: 'w' }]);
  s.expectPos({ x: 3, y: 1 });
  s.expectTurn(4);
  s.check((state) => {
    expect(state.visible.length).toBeGreaterThan(20);
  });
});

scenario('bumping a wall costs no turn and emits blocked', (s) => {
  s.level(['---', '|@.', '---']);
  s.act({ type: 'move', dir: 'w' });
  s.expectEvent({ type: 'blocked', pos: { x: 0, y: 1 }, terrain: T.vwall });
  s.expectPos({ x: 1, y: 1 });
  s.expectTurn(1);
  s.expectNoEvent('moved');
  s.expectNoEvent('turnEnded');
});

scenario('a closed door auto-opens (vertical wall)', (s) => {
  s.level([' | ', '@+.', ' | ']); // door in a vertical wall
  s.expectPos({ x: 0, y: 1 });
  s.act({ type: 'move', dir: 'e' });
  s.expectEvent({ type: 'doorOpened', pos: { x: 1, y: 1 } });
  s.expectTerrain({ x: 1, y: 1 }, T.door_open_v);
  s.expectPos({ x: 0, y: 1 });
  s.expectTurn(2);
});

scenario('a closed door auto-opens (horizontal wall)', (s) => {
  s.level([' @ ', '-+-', ' . ']);
  s.act({ type: 'move', dir: 's' });
  s.expectEvent({ type: 'doorOpened' });
  s.expectTerrain({ x: 1, y: 1 }, T.door_open_h);
  s.act({ type: 'move', dir: 's' });
  s.expectPos({ x: 1, y: 1 });
});

scenario('diagonal into an open door is blocked', (s) => {
  s.level(['-----', '|...|', '|.@.v', '|...|', '-----'].map((r) => r));
  // door 'h'/'v' variants are both intact doors
  s.player({ x: 3, y: 1 });
  s.act({ type: 'move', dir: 'se' });
  s.expectEvent({ type: 'blocked', terrain: T.door_open_v });
  s.expectPos({ x: 3, y: 1 });
  s.expectTurn(1);
  s.act({ type: 'move', dir: 's' });
  s.act({ type: 'move', dir: 'e' });
  s.expectPos({ x: 4, y: 2 });
  s.act({ type: 'move', dir: 'nw' }); // diagonal out of an open door
  s.expectNoEvent('moved');
  s.expectPos({ x: 4, y: 2 });
});

scenario('diagonal through a doorway works', (s) => {
  s.level(['-----', '|...|', '|.@.D', '|...|', '-----']);
  s.player({ x: 3, y: 1 });
  s.act({ type: 'move', dir: 'se' });
  s.expectEvent({ type: 'moved' });
  s.expectPos({ x: 4, y: 2 });
  s.act({ type: 'move', dir: 'nw' });
  s.expectPos({ x: 3, y: 1 });
});

scenario('wait and search advance the turn', (s) => {
  s.level(ROOM);
  s.act({ type: 'wait' });
  s.expectTurn(2);
  s.act({ type: 'search' });
  s.expectEvent({ type: 'searched' });
  s.expectTurn(3);
  s.expectNoEvent('moved');
});

test('failed expectations give a helpful message with the map', () => {
  const run = (): unknown =>
    runScenario([vanillaMod], (s) => {
      s.level(ROOM);
      s.act({ type: 'move', dir: 'e' });
      s.expectPos({ x: 1, y: 1 });
    });
  expect(run).toThrow(/expected player at \{"x":1,"y":1\}, found \{"x":4,"y":2\}/);
  expect(run).toThrow(/\|\.\.\.@\.\|/);
  expect(() =>
    runScenario([vanillaMod], (s) => {
      s.level(ROOM);
      s.expectEvent({ type: 'doorOpened' });
    }),
  ).toThrow(/doorOpened/);
  expect(() => runScenario([vanillaMod], (s) => s.level(['|@x|']))).toThrow(/not in the legend/);
});
