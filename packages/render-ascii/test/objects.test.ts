import { expect, test } from 'vitest';
import { objectLayer } from '../src/index';

test('objectLayer returns the top object id, or null', () => {
  expect(objectLayer({ g: 'nh:floor', v: true, o: 'nh:dagger' })).toBe('nh:dagger');
  expect(objectLayer({ g: 'nh:floor', v: false })).toBeNull();
});
