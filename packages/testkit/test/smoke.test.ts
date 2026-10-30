import { expect, test } from 'vitest';
import { TESTKIT_VERSION } from '../src/index';

test('smoke', () => {
  expect(TESTKIT_VERSION).toBe(1);
});
