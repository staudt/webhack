import { expect, test } from 'vitest';
import { CONTENT_VERSION } from '../src/index';

test('smoke', () => {
  expect(CONTENT_VERSION).toBe(1);
});
