import { expect, test } from 'vitest';
import { UI_VERSION } from '../src/index';

test('smoke', () => {
  expect(UI_VERSION).toBe(1);
});
