import { expect, test } from 'vitest';
import { mount } from '../src/main';

test('mount tolerates a missing root', () => {
  expect(() => mount(null)).not.toThrow();
});
