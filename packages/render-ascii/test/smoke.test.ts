import { expect, test } from 'vitest';
import { RENDER_ASCII_VERSION } from '../src/index';

test('smoke', () => {
  expect(RENDER_ASCII_VERSION).toBe(1);
});
