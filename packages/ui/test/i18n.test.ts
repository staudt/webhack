import { describe, expect, test, vi } from 'vitest';
import { mergeMessages, translate, type Catalogs } from '../src/i18n';

const cats: Catalogs = {
  en: { hi: 'Hello {name}', 'nh:newt': 'newt', see: 'See {what} x{n}', only: 'en only' },
  pt: { hi: 'Ola {name}' },
};

describe('translate', () => {
  test('placeholders', () => {
    expect(translate(cats, 'en', 'hi', { name: 'Bob' })).toBe('Hello Bob');
    expect(translate(cats, 'en', 'see', { what: 'x', n: 3 })).toBe('See x x3');
    expect(translate(cats, 'en', 'hi')).toBe('Hello {name}');
  });
  test('@ params are translated as keys', () => {
    expect(translate(cats, 'en', 'see', { what: '@nh:newt', n: 1 })).toBe('See newt x1');
  });
  test('missing keys, incl. nested, show [key] and warn once', () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(translate(cats, 'en', 'nope.a')).toBe('[nope.a]');
    expect(translate(cats, 'en', 'nope.a')).toBe('[nope.a]');
    expect(translate(cats, 'en', 'see', { what: '@nh:ghost', n: 1 })).toBe('See [nh:ghost] x1');
    expect(w).toHaveBeenCalledTimes(2);
    w.mockRestore();
  });
  test('locale fallback to en', () => {
    expect(translate(cats, 'pt', 'hi', { name: 'A' })).toBe('Ola A');
    expect(translate(cats, 'pt', 'only')).toBe('en only');
  });
  test('later addMessages wins', () => {
    const c: Catalogs = { en: { a: '1', b: 'b' } };
    mergeMessages(c, 'en', { a: '2' });
    expect(translate(c, 'en', 'a')).toBe('2');
    expect(translate(c, 'en', 'b')).toBe('b');
  });
});
