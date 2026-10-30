import { expect, test } from 'vitest';
import type { ClientApi, UiCommand } from '@nh/core';
import { vanillaKeys } from '../src/keys';

test('binds > and < to stairs', () => {
  const bound: Record<string, UiCommand> = {};
  vanillaKeys.register({ bindKey: (k: string, c: UiCommand) => void (bound[k] = c) } as ClientApi);
  expect(bound['>']).toEqual({ type: 'action', action: { type: 'mod', action: 'nh:down' } });
  expect(bound['<']).toEqual({ type: 'action', action: { type: 'mod', action: 'nh:up' } });
});

test('binds inventory and item verbs to ui commands', () => {
  const bound: Record<string, UiCommand> = {};
  vanillaKeys.register({ bindKey: (k: string, c: UiCommand) => void (bound[k] = c) } as ClientApi);
  expect(bound['i']).toEqual({ type: 'ui', id: 'inventory' });
  expect(bound[',']).toEqual({ type: 'ui', id: 'self:nh:pickup' });
  expect(bound['\\']).toEqual({ type: 'ui', id: 'self:nh:discoveries' });
  const picks: Record<string, string> = {
    d: 'drop',
    w: 'wield',
    W: 'wear',
    T: 'takeoff',
    e: 'eat',
    q: 'quaff',
    r: 'read',
    t: 'throw',
  };
  for (const [k, v] of Object.entries(picks)) {
    expect(bound[k]).toEqual({ type: 'ui', id: `pick:nh:${v}` });
  }
});
