import { expect, test } from 'vitest';
import { CORE_VERSION } from '../src/index';

test('smoke', () => {
  expect(CORE_VERSION).toBe(1);
});
