import { expect, test } from 'vitest';
import { createAsciiRenderer, fitCell } from '../src/index';

test('fitCell shows the whole map width, floored, with a minimum', () => {
  expect(fitCell(390, 80)).toBe(4);
  expect(fitCell(1280, 80)).toBe(16);
  expect(fitCell(100, 80)).toBe(3);
  expect(fitCell(390, 0)).toBe(3);
});

test('the ascii renderer offers flash() and tolerates it before mounting', () => {
  const r = createAsciiRenderer();
  expect(typeof r.flash).toBe('function');
  expect(() => {
    r.flash({ x: 1, y: 2 }, 'nh:dagger');
    r.flash({ x: 0, y: 0 }, null);
  }).not.toThrow();
});
