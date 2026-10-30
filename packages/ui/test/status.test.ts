import { describe, expect, test } from 'vitest';
import { ripArt } from '../src/status';

describe('ripArt', () => {
  test('stone edges line up on every row', () => {
    const lines = ripArt(['REST IN PEACE', 'killed by a jackal', 'on turn 141']).split('\n');
    const rows = lines.filter((l) => l.includes('|'));
    const left = rows.map((l) => l.indexOf('|'));
    const right = rows.map((l) => l.lastIndexOf('|'));
    expect(new Set(left).size).toBe(1);
    expect(new Set(right).size).toBe(1);
    // The roof sits one column inside the walls on each side.
    const roof = lines[1] as string;
    expect(roof.indexOf('/')).toBe((left[0] as number) + 1);
    expect(roof.indexOf('\\')).toBe((right[0] as number) - 1);
  });

  test('widens for long lines', () => {
    const long = 'killed by a very long monster name here';
    const art = ripArt([long]);
    expect(art).toContain(`|${long}|`);
  });
});

import { statusLines } from '../src/status';

describe('statusLines line 2', () => {
  test('NetHack order with gold, hunger and encumbrance', () => {
    const [, l2] = statusLines({
      dlvl: 1,
      gold: 0,
      hp: 16,
      hpmax: 16,
      ac: 6,
      xl: 1,
      xp: 0,
      turn: 1,
      hunger: 'weak',
      encumbrance: 'strained',
    });
    expect(l2.map((f) => f.text)).toEqual([
      'Dlvl:1',
      '$:0',
      'HP:16(16)',
      'AC:6',
      'Xp:1/0',
      'T:1',
      'Weak',
      'Strained',
    ]);
    expect(l2.at(-2)?.cls).toBe('nh-hp-crit');
    expect(l2.at(-1)?.cls).toBe('nh-hp-crit');
  });

  test('mild states have no critical class; absent fields are omitted', () => {
    const [, l2] = statusLines({ turn: 3, hunger: 'hungry', encumbrance: 'burdened' });
    expect(l2.map((f) => f.text)).toEqual(['T:3', 'Hungry', 'Burdened']);
    expect(l2[2]?.cls).toBeUndefined();
  });
});
