import { vanillaMod } from '@nh/content';
import { describe, expect, test } from 'vitest';
import { randomActions } from './helpers/actions';
import { recordGame, runReplay } from '../src/index';

describe('replay', () => {
  // A seed whose hero survives this random walk (the walk doesn't fight back).
  const opts = { seed: 4, width: 80, height: 21 };
  const actions = randomActions(300, 7);

  test('record then replay gives the same hash', () => {
    const rec = recordGame([vanillaMod], opts, actions);
    const out = runReplay([vanillaMod], rec);
    expect(out.hash).toBe(rec.hash);
    expect(rec.actions).toHaveLength(300);
    expect(out.state.turn).toBeGreaterThan(1);
  });

  test('changing an action changes the hash', () => {
    const rec = recordGame([vanillaMod], opts, actions);
    // Random walks can converge on the same corner, so compare a mid-game prefix for a swap
    // and the full game for an extra turn-consuming action.
    const prefix = { ...rec, actions: rec.actions.slice(0, 20) };
    const swapped = { ...prefix, actions: prefix.actions.map((a) => ({ ...a })) };
    swapped.actions[11] = { type: 'wait' }; // original is a northward move
    expect(runReplay([vanillaMod], swapped).hash).not.toBe(runReplay([vanillaMod], prefix).hash);

    const extra = { ...rec, actions: [...rec.actions] };
    extra.actions.splice(150, 0, { type: 'wait' });
    expect(runReplay([vanillaMod], extra).hash).not.toBe(rec.hash);
  });

  test('mod mismatch throws', () => {
    const rec = recordGame([vanillaMod], opts, []);
    rec.mods = [{ id: 'nh', version: '9.9.9' }];
    expect(() => runReplay([vanillaMod], rec)).toThrow(/mod mismatch/);
    rec.mods = [];
    expect(() => runReplay([vanillaMod], rec)).toThrow(/mod mismatch/);
  });
});
