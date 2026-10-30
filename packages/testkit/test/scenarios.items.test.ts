import { vanillaMod } from '@nh/content';
import { inventoryOf, getPlayer } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { createScenario, runScenario } from '../src/index';

const scenario = createScenario([vanillaMod]);
const ROOM = ['-------', '|.....|', '|..@..|', '|.....|', '-------'];
const HERE = { x: 3, y: 2 };

describe('item scenarios', () => {
  scenario('the Valkyrie starts with her kit', (s) => {
    s.level(ROOM);
    s.expectInventory([
      { def: 'nh:spear', letter: 'a', equipped: 'weapon', spe: 1 },
      { def: 'nh:dagger', letter: 'b', equipped: null },
      { def: 'nh:small_shield', letter: 'c', equipped: 'shield' },
      'nh:food_ration',
    ]);
    s.expectWielded('nh:spear');
    s.expectAc(6); // 10 - small shield (1 + 3)
  });

  scenario('clearInventory then item(): exact fields, letters and AC', (s) => {
    s.level(ROOM);
    s.clearInventory();
    s.expectInventory([]);
    s.expectWielded(null);
    s.expectAc(10);
    s.item('nh:long_sword', 'inventory', {
      equipped: 'weapon',
      spe: 2,
      buc: 'blessed',
      known: true,
    });
    s.item('nh:dagger', 'inventory', { quantity: 4 });
    s.item('nh:dagger', 'inventory', { quantity: 2, buc: 'cursed' });
    s.expectInventory([
      { def: 'nh:long_sword', letter: 'a', equipped: 'weapon', spe: 2, buc: 'blessed' },
      { def: 'nh:dagger', letter: 'b', quantity: 4 },
      { def: 'nh:dagger', letter: 'c', quantity: 2, buc: 'cursed' },
    ]);
    s.expectWielded('nh:long_sword');
    s.item('nh:small_shield', 'inventory', { equipped: 'shield', spe: 1 });
    s.expectAc(10 - 1 - 1);
    s.expectInventory(['nh:dagger'], { only: false });
  });

  scenario('floor items: expectItemAt, pickup and drop', (s) => {
    s.level(ROOM);
    s.clearInventory();
    s.item('nh:apple', HERE, { quantity: 3 });
    s.expectItemAt(HERE, 'nh:apple', 3);
    s.expectNoItemAt({ x: 4, y: 2 });
    s.act({ type: 'mod', action: 'nh:pickup' });
    s.expectNoItemAt(HERE);
    s.expectInventory([{ def: 'nh:apple', quantity: 3 }]);
  });

  test('eating from the inventory, using the item offers', () => {
    const r = runScenario([vanillaMod], (s) => {
      s.level(ROOM);
      s.clearInventory();
      s.setHunger(40);
      s.expectHunger('weak');
      s.item('nh:food_ration', 'inventory');
    });
    const ration = inventoryOf(r.state, r.state.playerId)[0]!;
    const offer = r.engine
      .query(r.state)
      .actionsFor({ kind: 'item', id: ration.id })
      .find((o) => o.labelKey === 'action.nh:eat');
    expect(offer).toBeDefined();
    for (let i = 0; i < 12 && i < 11; i++) {
      r.engine.step(r.state, i === 0 ? offer!.action : { type: 'wait' });
    }
    expect(getPlayer(r.state).c.hunger!.nutrition).toBeGreaterThan(300);
  });

  scenario('setHunger picks the matching state', (s) => {
    s.level(ROOM);
    s.setHunger(2000);
    s.expectHunger('satiated');
    s.setHunger(500);
    s.expectHunger('not_hungry');
    s.setHunger(100);
    s.expectHunger('hungry');
    s.setHunger(0);
    s.expectHunger('fainting');
  });

  test('builder errors are reported', () => {
    expect(() => runScenario([vanillaMod], (s) => s.item('nh:nothing', 'inventory'))).toThrow(
      /not a registered object/,
    );
    expect(() =>
      runScenario([vanillaMod], (s) => {
        s.level(ROOM);
        s.item('nh:apple', { x: 0, y: 0 });
      }),
    ).toThrow(/not passable/);
    expect(() =>
      runScenario([vanillaMod], (s) => {
        s.level(ROOM);
        s.expectInventory([]);
      }),
    ).toThrow(/unexpected items/);
    expect(() =>
      runScenario([vanillaMod], (s) => {
        s.level(ROOM);
        s.expectWielded('nh:dagger');
      }),
    ).toThrow(/expected wielded/);
    expect(() =>
      runScenario([vanillaMod], (s) => {
        s.level(ROOM);
        s.item('nh:long_sword', 'inventory', { equipped: 'weapon' });
      }),
    ).toThrow(/already occupied/);
    expect(() =>
      runScenario([vanillaMod], (s) => {
        s.level(ROOM);
        s.expectItemAt(HERE, 'nh:apple');
      }),
    ).toThrow(/expected nh:apple/);
  });
});
