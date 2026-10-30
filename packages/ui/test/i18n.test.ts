import { describe, expect, test, vi } from 'vitest';
import type { Params } from '@nh/core';
import { justAn, mergeMessages, translate, type Catalogs } from '../src/i18n';

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

describe('translate nested messages', () => {
  const c: Catalogs = {
    en: { outer: 'You see {what}.', mid: '{n} of {inner}', leaf: 'apple', loop: '<{x}>' },
  };
  test('{ key, params } params are translated recursively, two levels deep', () => {
    expect(
      translate(c, 'en', 'outer', {
        what: { key: 'mid', params: { n: 3, inner: { key: 'leaf' } } },
      }),
    ).toBe('You see 3 of apple.');
  });
  test('the depth guard stops runaway nesting', () => {
    let p: Params = { x: { key: 'leaf' } };
    for (let i = 0; i < 8; i++) p = { x: { key: 'loop', params: p } };
    const out = translate(c, 'en', 'loop', p);
    expect(out).toMatch(/^<(<)+\[loop\]>+$/);
    expect(out).not.toContain('apple');
  });
});

describe('{param|an}', () => {
  const cat = {
    en: {
      see: 'You see here {item|an}.',
      spear: 'spear',
      apple: 'apple',
      unicorn: 'unicorn horn',
      two: '{count} {name}',
      'nh:dagger.plural': 'daggers',
    },
  };
  test('picks a/an from the rendered text (just_an)', () => {
    expect(translate(cat, 'en', 'see', { item: { key: 'spear' } })).toBe('You see here a spear.');
    expect(translate(cat, 'en', 'see', { item: { key: 'apple' } })).toBe('You see here an apple.');
    expect(translate(cat, 'en', 'see', { item: { key: 'unicorn' } })).toBe(
      'You see here a unicorn horn.',
    );
    expect(
      translate(cat, 'en', 'see', {
        item: { key: 'two', params: { count: 2, name: { key: 'nh:dagger.plural' } } },
      }),
    ).toBe('You see here 2 daggers.');
  });
  test.each([
    ['elven dagger', 'an '],
    ['one-eyed sam', 'a '],
    ['onerous task', 'an '],
    ['eucalyptus leaf', 'a '],
    ['x', 'an '],
    ['xray', 'an '],
    ['xorn', 'a '],
    ['the Amulet', ''],
    ['iron bars', ''],
    ['useful tool', 'a '],
    ['uncursed dagger', 'an '],
  ])('%s', (s, want) => expect(justAn(s)).toBe(want));
});
