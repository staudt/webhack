import { expect, test } from 'vitest';
import type { ClientApi, UiCommand } from '@nh/core';
import { vanillaKeys } from '../src/keys';

test('binds > and < to stairs', () => {
  const bound: Record<string, UiCommand> = {};
  vanillaKeys.register({ bindKey: (k: string, c: UiCommand) => void (bound[k] = c) } as ClientApi);
  expect(bound['>']).toEqual({ type: 'action', action: { type: 'mod', action: 'nh:down' } });
  expect(bound['<']).toEqual({ type: 'action', action: { type: 'mod', action: 'nh:up' } });
});
