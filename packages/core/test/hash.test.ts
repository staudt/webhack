import { describe, expect, test } from 'vitest';
import { canonicalJson, isJsonPlain, stateHash } from '../src/hash';

describe('hash', () => {
  test('key order independence', () => {
    const a: Record<string, unknown> = {};
    a.x = 1;
    a.y = { q: [1, 2], p: 'a' };
    const b: Record<string, unknown> = {};
    b.y = { p: 'a', q: [1, 2] };
    b.x = 1;
    expect(canonicalJson(a)).toBe('{"x":1,"y":{"p":"a","q":[1,2]}}');
    expect(stateHash(a)).toBe(stateHash(b));
  });

  test('values, arrays, format', () => {
    expect(stateHash({ a: 1 })).not.toBe(stateHash({ a: 2 }));
    expect(stateHash([1, 2])).not.toBe(stateHash([2, 1]));
    expect(stateHash({ a: 1 })).toMatch(/^[0-9a-f]{28}$/);
    expect(stateHash('')).toMatch(/^[0-9a-f]{28}$/);
  });

  test('scalars and null-proto objects', () => {
    expect(canonicalJson([null, true, false, 'a"b', -0.5])).toBe('[null,true,false,"a\\"b",-0.5]');
    const o = Object.create(null) as Record<string, unknown>;
    o.k = 1;
    expect(canonicalJson(o)).toBe('{"k":1}');
  });

  test('throws on non-JSON values', () => {
    class Foo {}
    for (const v of [new Map(), new Set(), () => 1, NaN, Infinity, [undefined], new Foo(), 1n, undefined, Symbol('s'), { a: [new Foo()] }]) {
      expect(() => canonicalJson(v)).toThrow(TypeError);
    }
  });

  test('undefined property omitted', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stateHash({ a: 1, b: undefined })).toBe(stateHash({ a: 1 }));
  });

  test('isJsonPlain', () => {
    expect(isJsonPlain({ a: [1, 'x', null] })).toBe(true);
    expect(isJsonPlain(new Map())).toBe(false);
    expect(isJsonPlain(NaN)).toBe(false);
  });
});
