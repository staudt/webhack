import { vanillaMod } from '@nh/content';
import { describe, expect, test } from 'vitest';
import { createScenario, runScenario } from '../src/index';

const scenario = createScenario([vanillaMod]);

const ROOM = ['-------', '|.....|', '|..@..|', '|.....|', '-------'];
const NEWT = { x: 4, y: 2 };

/** Finds the first seed where the hero kills a fresh newt on exactly the `attacks`-th attack. */
function seedThatKillsNewt(attacks: number): number {
  for (let seed = 1; seed < 500; seed++) {
    try {
      runScenario([vanillaMod], (s) => {
        s.seed(seed);
        s.level(ROOM);
        s.monster('nh:newt', NEWT, { asleep: true });
        // The newt must survive the first attacks-1 attacks so the final one is the kill.
        for (let i = 0; i < attacks - 1; i++) s.act({ type: 'move', dir: 'e' });
        s.expectMonsterAt(NEWT, 'nh:newt');
        s.act({ type: 'move', dir: 'e' });
        s.expectNoMonsterAt(NEWT);
      });
      return seed;
    } catch {
      // try the next seed
    }
  }
  throw new Error('no seed found');
}

const KILL_SEED = seedThatKillsNewt(3);

describe('combat scenarios', () => {
  scenario('hero kills a newt (seed chosen by search)', (s) => {
    s.seed(KILL_SEED);
    s.level(ROOM);
    s.monster('nh:newt', NEWT, { asleep: true });
    s.expectMonsterAt(NEWT, 'nh:newt');
    s.act([
      { type: 'move', dir: 'e' },
      { type: 'move', dir: 'e' },
      { type: 'move', dir: 'e' },
    ]);
    s.expectNoMonsterAt(NEWT);
    s.expectPos({ x: 3, y: 2 });
    s.expectAlive();
  });

  scenario('a jackal bites the hero', (s) => {
    s.level(ROOM);
    s.setHero({ hp: 100, maxHp: 100, ac: 10 });
    s.monster('nh:jackal', { x: 4, y: 2 });
    // The hero waits; over several turns a hostile adjacent jackal must land a bite.
    s.act(Array.from({ length: 12 }, () => ({ type: 'wait' as const })));
    s.expectEvent({ type: 'msg', key: 'combat.mon_bites' });
    s.expectHp({ max: 99 });
  });

  scenario('a rothe kills a 1 hp hero', (s) => {
    s.level(ROOM);
    s.setHero({ hp: 1, maxHp: 16, ac: 10 });
    s.monster('nh:rothe', { x: 4, y: 2 });
    s.act(Array.from({ length: 20 }, () => ({ type: 'wait' as const })));
    s.expectDead('nh:rothe');
    s.expectGameOver('died');
  });

  scenario('declining to leave the dungeon keeps the hero alive', (s) => {
    s.level(['-----', '|.<.|', '-----']);
    s.expectPos({ x: 2, y: 1 });
    s.act({ type: 'mod', action: 'nh:up' });
    s.check((state) => expect(state.pendingPrompt).not.toBeNull());
    s.act({ type: 'answer', promptId: 'leave-dungeon', value: false });
    s.check((state) => expect(state.pendingPrompt).toBeNull());
    s.expectAlive();
  });

  test('failure messages list monsters with hp', () => {
    expect(() =>
      runScenario([vanillaMod], (s) => {
        s.level(ROOM);
        s.monster('nh:newt', NEWT, { hp: 3, asleep: true });
        s.expectNoMonsterAt(NEWT);
      }),
    ).toThrow(/nh:newt#\d+@4,2 hp 3\/3/);
  });
});
