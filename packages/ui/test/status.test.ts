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
