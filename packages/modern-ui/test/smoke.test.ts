import { expect, test } from 'vitest';
import * as mod from '../src/index';

test('stub module loads', () => {
  expect(Object.keys(mod)).toEqual([]);
});
